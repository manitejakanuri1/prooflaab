"""STAGING ONLY. Daily Lots at the RELEASE TARGET: exactly 2,000 synthetic students (6 Oct 2026).

    python scripts/dev-tools/staging_daily_lots_release2k_check.py            # run the check
    python scripts/dev-tools/staging_daily_lots_release2k_check.py --restore  # only put staging back (after a crash)

The 15,000-student test (staging_daily_lots_status_check.py) stays as the separate stress test. Here the job
really sees 2,000 students: every OTHER active staging student is parked (status 'release2k_parked') for the
duration, so the nightly job's own rule (status = 'active') leaves exactly Load Student 1..2000.

Crash safety: before anything changes, the original status, updated_at and preferred_skills of every row this
test touches are copied into release_test.park_2k IN THE STAGING DATABASE. Restore (run in `finally`, and by
--restore) copies them back with the updated_at trigger off inside that transaction, then drops the snapshot.
A run refuses to start while an old snapshot exists. Real students cannot be touched: the population is chosen
by the synthetic name pattern, and staging has no real students.

Proves, each against the database (not only the job's reply):
  A. 2,000 healthy -> success, HTTP 200; every one of the 2,000 has exactly one Lot today
  B. a re-run is idempotent: 0 new Lots, still exactly 2,000, no duplicates
  C. 10 bad-data students -> partial_failure, HTTP 200; the 1,990 healthy ones still get their Lot
  D. the 10 repaired -> success; they receive their missing Lot
  E. 100 bad-data students (over the 50-student failure line) -> failure, HTTP 500 ok:false; 1,900 healthy get Lots
  F. the 100 repaired -> success; they receive their missing Lot; exactly 2,000, no duplicates
  G. every run finished within production's Cloud Scheduler budget (1 + retryCount, read live)
  H. parked students' Lots were not touched; nothing outside the 2,000 changed
No AI is used. Results: e2e-out/final/daily-lots-2k.json
"""
import datetime, json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

N = 2000
PARK = "release2k_parked"
TARGET = f"full_name ~ '^Load Student [0-9]+$' and substring(full_name from 14)::int between 1 and {N}"
BROKEN = "array[array['x','y']]"          # a two-dimensional skills array makes create_lot_for() raise (same as the 15k test)
results, runs = [], []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL"), name, "-", json.dumps(detail, default=str)[:260], flush=True)


def sql(text):
    """Writes only. Each file is one transaction; the runner's exit code is the proof it committed."""
    f = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8", newline="\n")
    f.write("\\set ON_ERROR_STOP on\nbegin;\nselect set_config('app.system_write','on',true);\n" + text.rstrip() + "\ncommit;\n"); f.close()
    r = subprocess.run(["bash", "scripts/dev-tools/staging_sql.sh", f.name.replace("\\", "/")], capture_output=True, text=True)
    os.unlink(f.name)
    if "exit=0" not in r.stdout:
        raise RuntimeError("staging SQL failed: " + r.stdout[-600:])


def get(path):
    c, b = st.call("svc", "GET", path)
    if c != 200 or not isinstance(b, list):
        raise RuntimeError(f"read failed {c}: {str(b)[:200]}")
    return b


def production_attempt_budget():
    out = subprocess.run("gcloud scheduler jobs describe prooflab-daily-lots --location=asia-south1 --project=prooflab-508214 "
                         "--format=value(retryConfig.retryCount)", shell=True, capture_output=True, text=True).stdout.strip()
    return 1 + int(out) if out.isdigit() else 1


def run_once():
    req = urllib.request.Request(f"{st.FUNCTIONS}/scheduled-job?job=daily-lots", data=b"{}", method="POST", headers=st.scheduler_headers())
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"ok": False, "error": raw[:500] or f"HTTP {e.code} with an empty body"}


def run_job(label):
    """As Cloud Scheduler does: a try that stops at its time limit is retried and continues where it stopped."""
    made, t0 = 0, time.time()
    for n in range(1, 11):
        c, b = run_once()
        m = re.search(r"\((\d+) Lots created\); the retry continues", str(b.get("error") or ""))
        if c == 500 and m:
            made += int(m.group(1)); print("  (try stopped at its time limit; retrying as Scheduler would)", flush=True)
            continue
        r = b.get("result") if isinstance(b.get("result"), dict) else {}
        if made:
            r["lots_created"] = r.get("lots_created", 0) + made
        runs.append({"run": label, "tries": n, "http": c, "seconds": round(time.time() - t0, 1),
                     **{k: r.get(k) for k in ("status", "lots_created", "already_had_one", "failed", "students")}})
        print(f"  run {label}: HTTP {c} in {n} tr{'y' if n == 1 else 'ies'}, {round(time.time() - t0)} s, {runs[-1]}", flush=True)
        return c, b, r
    runs.append({"run": label, "tries": 99, "http": c})
    return c, b, {}


def today():
    return datetime.datetime.now(datetime.timezone.utc).date().isoformat()


def state(ids):
    """Exact counts from the database for the target students and everyone else."""
    lots = get(f"tasks?select=student_id&lot_date=eq.{today()}")
    per = {}
    for x in lots:
        per[x["student_id"]] = per.get(x["student_id"], 0) + 1
    return {"with_lot": sum(1 for i in ids if per.get(i)), "missing": sum(1 for i in ids if not per.get(i)),
            "duplicates": sum(c - 1 for c in per.values() if c > 1), "outside_lots": sum(c for s, c in per.items() if s not in ids)}


def restore():
    """Put every touched row back exactly, then drop the snapshot. Safe to run twice."""
    sql("""do $r$ begin
  if to_regclass('release_test.park_2k') is null then return; end if;
  alter table public.student_profiles disable trigger student_profiles_set_updated_at;
  update public.student_profiles p set status = s.status, updated_at = s.updated_at, preferred_skills = s.preferred_skills
    from release_test.park_2k s where p.id = s.id;
  alter table public.student_profiles enable trigger student_profiles_set_updated_at;
  drop table release_test.park_2k;
  drop schema if exists release_test;
end $r$;""")


if "--restore" in sys.argv:
    restore()
    print("restored; active students now:", len(get("student_profiles?select=id&status=eq.active")))
    sys.exit(0)

BUDGET = production_attempt_budget()
before_active = len(get("student_profiles?select=id&status=eq.active"))
before_parked = len(get(f"student_profiles?select=id&status=eq.{PARK}"))
print(f"staging before: {before_active} active students, {before_parked} already parked; production Scheduler budget = {BUDGET} tries", flush=True)
if before_parked:
    sys.exit("refusing: students are already parked - a previous run did not finish; run with --restore first")

try:
    # 0. Snapshot, then park everyone except Load Student 1..2000 (one transaction; the trigger is off only inside it).
    sql(f"""do $p$ begin
  if to_regclass('release_test.park_2k') is not null then raise exception 'snapshot already exists - run --restore'; end if;
end $p$;
create schema release_test;
create table release_test.park_2k as
  select id, status, updated_at, preferred_skills from public.student_profiles
   where (status = 'active' and not ({TARGET})) or ({TARGET});
alter table release_test.park_2k add primary key (id);
alter table public.student_profiles disable trigger student_profiles_set_updated_at;
update public.student_profiles set status = '{PARK}' where status = 'active' and not ({TARGET});
alter table public.student_profiles enable trigger student_profiles_set_updated_at;""")
    target = [r["id"] for r in get("student_profiles?select=id,full_name&status=eq.active&order=id")]
    names_ok = all(re.fullmatch(r"Load Student \d+", r["full_name"]) and 1 <= int(r["full_name"][13:]) <= N
                   for r in get("student_profiles?select=full_name&status=eq.active"))
    check("population: exactly 2,000 eligible students, all Load Student 1..2000",
          len(target) == N and names_ok, {"active": len(target), "parked": len(get(f"student_profiles?select=id&status=eq.{PARK}"))})
    if len(target) != N:
        raise RuntimeError("population is not exactly 2,000 - stopping")
    ids = set(target)
    outside0 = state(ids)["outside_lots"]
    order = target                      # the job walks students in id order; break the first ones (worst case for retries)
    del_today = f"delete from public.tasks where lot_date = current_date and student_id in (select id from public.student_profiles where status = 'active');"

    # A. healthy 2,000
    sql(del_today)
    s0 = state(ids)
    c, b, r = run_job("A healthy")
    s = state(ids)
    check("A. 2,000 healthy -> success, HTTP 200, 2,000 Lots created", c == 200 and r.get("status") == "success" and r.get("failed") == 0
          and r.get("lots_created") == N and r.get("students") == N, {"http": c, **r, "missing_before": s0["missing"]})
    check("A. database: every one of the 2,000 has exactly one Lot today", s["with_lot"] == N and s["missing"] == 0 and s["duplicates"] == 0, s)

    # B. re-run is idempotent
    c, b, r = run_job("B rerun")
    s = state(ids)
    check("B. re-run: success, 0 new Lots, 2,000 already had one", c == 200 and r.get("status") == "success" and r.get("lots_created") == 0
          and r.get("already_had_one") == N, {"http": c, **r})
    check("B. database: still exactly 2,000, no duplicates", s["with_lot"] == N and s["duplicates"] == 0, s)

    # C. 10 isolated bad-data students
    bad10 = order[:10]
    sql(del_today + f"\nupdate public.student_profiles set preferred_skills = {BROKEN} where id in ({','.join(repr(i) for i in bad10)});")
    c, b, r = run_job("C 10 bad")
    s = state(ids)
    got_bad = sum(1 for x in get(f"tasks?select=student_id&lot_date=eq.{today()}&student_id=in.({','.join(bad10)})"))
    check("C. 10 bad -> partial_failure, HTTP 200, failed 10, 1,990 Lots", c == 200 and r.get("status") == "partial_failure"
          and r.get("failed") == 10 and r.get("lots_created") == N - 10, {"http": c, **r})
    check("C. database: the 1,990 healthy have a Lot, the 10 bad have none, no duplicates",
          s["with_lot"] == N - 10 and got_bad == 0 and s["duplicates"] == 0, {**s, "bad_with_lot": got_bad})

    # D. repair the 10
    sql(f"update public.student_profiles p set preferred_skills = s.preferred_skills from release_test.park_2k s where p.id = s.id and p.id in ({','.join(repr(i) for i in bad10)});")
    c, b, r = run_job("D repaired 10")
    s = state(ids)
    check("D. repaired 10 -> success, exactly 10 new Lots", c == 200 and r.get("status") == "success" and r.get("lots_created") == 10, {"http": c, **r})
    check("D. database: all 2,000 have exactly one Lot", s["with_lot"] == N and s["duplicates"] == 0, s)

    # E. 100 bad (over the failure line)
    bad100 = order[:100]
    sql(del_today + f"\nupdate public.student_profiles set preferred_skills = {BROKEN} where id in ({','.join(repr(i) for i in bad100)});")
    c, b, r = run_job("E 100 bad")
    s = state(ids)
    check("E. 100 bad -> failure, HTTP 500, ok:false, failed 100, 1,900 Lots", c == 500 and b.get("ok") is False and r.get("status") == "failure"
          and r.get("failed") == 100 and r.get("lots_created") == N - 100, {"http": c, "ok": b.get("ok"), **r})
    check("E. database: the 1,900 healthy still got their Lot, no duplicates", s["with_lot"] == N - 100 and s["duplicates"] == 0, s)

    # F. repair the 100
    sql(f"update public.student_profiles p set preferred_skills = s.preferred_skills from release_test.park_2k s where p.id = s.id and p.id in ({','.join(repr(i) for i in bad100)});")
    c, b, r = run_job("F repaired 100")
    s = state(ids)
    check("F. repaired 100 -> success, exactly 100 new Lots", c == 200 and r.get("status") == "success" and r.get("lots_created") == 100, {"http": c, **r})
    check("F. database: all 2,000 have exactly one Lot, no duplicates", s["with_lot"] == N and s["missing"] == 0 and s["duplicates"] == 0, s)

    # G, H
    check(f"G. every run finished within production's Scheduler budget ({BUDGET} tries)", max(x["tries"] for x in runs) <= BUDGET,
          [(x["run"], x["tries"], x.get("seconds")) for x in runs])
    check("H. Lots of the parked students were not touched", state(ids)["outside_lots"] == outside0, {"before": outside0, "after": state(ids)["outside_lots"]})
finally:
    restore()
    after_active = len(get("student_profiles?select=id&status=eq.active"))
    after_parked = len(get(f"student_profiles?select=id&status=eq.{PARK}"))
    check("cleanup: every parked student restored, snapshot removed", after_active == before_active and after_parked == 0,
          {"active_before": before_active, "active_after": after_active, "parked_after": after_parked})

os.makedirs(os.path.join("e2e-out", "final"), exist_ok=True)
json.dump({"runs": runs, "checks": results, "budget": BUDGET}, open(os.path.join("e2e-out", "final", "daily-lots-2k.json"), "w"), indent=1)
print(f"\n{sum(r['ok'] for r in results)}/{len(results)} checks passed")
sys.exit(0 if all(r["ok"] for r in results) else 1)
