"""STAGING ONLY. Daily Lots at the RELEASE TARGET: the job walks exactly 2,000 students (BLOCKING launch gate).

    python scripts/dev-tools/staging_daily_lots_release2k_check.py            # run the check
    python scripts/dev-tools/staging_daily_lots_release2k_check.py --restore  # only put staging back (after a crash)

The 15,000-student test (staging_daily_lots_status_check.py) is the separate, ADVISORY stress test.

Write safety (repaired 6 Oct 2026 after review):
  * Only rows named exactly "Load Student <n>" (synthetic load-test students) are ever written: parked, given bad
    data, or have their own Lots of today deleted. Every other active student (staging fixtures, test logins) is
    left active and is NEVER written; the job only reads them. If any of them has no Lot today the job would write
    one for them, so the check aborts before any write.
  * The job's population is made exactly 2,000: the non-load active students (they already have today's Lot) plus
    Load Student 1..(2000 - that number). Every other load student is parked for the duration.
  * Before any task is deleted, no target task may have dependent rows in ANY table that references tasks
    (task_submissions and task_assignments are deleted with a task; voice_explanations and student_levels lose
    their link). If one does, the check aborts before deleting anything.
  * status, updated_at and preferred_skills of every written student are snapshotted in the staging database
    (release_test.park_2k) and restored in `finally` (or by --restore) with the updated_at trigger off only inside
    that transaction. Afterwards an exact fingerprint of EVERY student row (id, status, updated_at, skills) must
    equal the one taken before. Today's Lots of the target students are DELETED AND RE-CREATED by the job (new ids):
    that part is a logical restore (each target student again has exactly one Lot today), not a byte restore.
  * Every Lot of today outside the target is fingerprinted (id, student, date, source, title, status) before and
    after; the set must be identical (added / removed / changed all 0).

Proves against the database: A healthy -> success, all get exactly one Lot; B re-run idempotent; C 10 bad ->
partial_failure (200), the healthy still get Lots; D the 10 repaired get theirs; E 100 bad -> failure (500, ok:false),
the healthy still get Lots; F the 100 repaired get theirs; G every run within production's Scheduler budget (read
live); H nothing outside the target changed; I every student row restored exactly. No AI is used.
Results: e2e-out/final/daily-lots-2k.json
"""
import datetime, hashlib, json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

N = 2000
PARK = "release2k_parked"
LOAD_RE = re.compile(r"Load Student (\d+)")
LOAD_SQL = "full_name ~ '^Load Student [0-9]+$'"
NUM = "substring(full_name from 14)::int"     # "Load Student <n>" -> n; rows are chosen by predicate, never by long id lists
BROKEN = "array[array['x','y']]"          # a two-dimensional skills array makes create_lot_for() raise (same as the 15k test)
DEPENDENTS = ("task_submissions", "task_assignments", "voice_explanations", "student_levels")
results, runs = [], []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL"), name, "-", json.dumps(detail, default=str)[:300], flush=True)


def sql(text):
    """Writes only. Each call is one transaction; the runner's exit code is the proof it committed."""
    f = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8", newline="\n")
    f.write("\\set ON_ERROR_STOP on\nbegin;\nselect set_config('app.system_write','on',true);\n" + text.rstrip() + "\ncommit;\n"); f.close()
    r = subprocess.run(["bash", "scripts/dev-tools/staging_sql.sh", f.name.replace("\\", "/")], capture_output=True, text=True)
    os.unlink(f.name)
    if r.returncode != 0 or "exit=0" not in r.stdout:
        raise RuntimeError("staging SQL failed: " + r.stdout[-600:] + r.stderr[-300:])


def get(path):
    c, b = st.call("svc", "GET", path)
    if c != 200 or not isinstance(b, list):
        raise RuntimeError(f"read failed {c}: {str(b)[:200]}")
    return b


def production_attempt_budget():
    out = subprocess.run("gcloud scheduler jobs describe prooflab-daily-lots --location=asia-south1 --project=prooflab-508214 "
                         "--format=value(retryConfig.retryCount)", shell=True, capture_output=True, text=True).stdout.strip()
    if not out.isdigit():
        raise RuntimeError(f"could not read production's Scheduler retry budget: {out!r}")
    return 1 + int(out)


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


def lots_today():
    return get(f"tasks?select=id,student_id,lot_date,source_content_id,title,status&lot_date=eq.{today()}")


def lot_state(target):
    per = {}
    for x in lots_today():
        per[x["student_id"]] = per.get(x["student_id"], 0) + 1
    return {"with_lot": sum(1 for i in target if per.get(i)), "missing": sum(1 for i in target if not per.get(i)),
            "duplicates": sum(c - 1 for c in per.values() if c > 1)}


def outside_lots(target):
    return {x["id"]: json.dumps(x, sort_keys=True) for x in lots_today() if x["student_id"] not in target}


def compare(before, after):
    return {"added": len(set(after) - set(before)), "removed": len(set(before) - set(after)),
            "changed": sum(1 for k in set(before) & set(after) if before[k] != after[k])}


def student_fingerprint():
    rows = get("student_profiles?select=id,status,updated_at,preferred_skills&order=id")
    return {r["id"]: hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest() for r in rows}


def ids_sql(ids):
    return ",".join("'" + i + "'" for i in ids)


def restore():
    """Put every written student row back from the snapshot, then drop the snapshot. Safe to run twice."""
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
    print("restored; active students now:", len(get("student_profiles?select=id&status=eq.active")),
          "| parked:", len(get(f"student_profiles?select=id&status=eq.{PARK}")))
    sys.exit(0)

# ---- preflight: everything below is read-only; any problem stops the run before a single write ------------
BUDGET = production_attempt_budget()
active = get("student_profiles?select=id,full_name&status=eq.active&order=id")
parked_already = get(f"student_profiles?select=id&status=eq.{PARK}")
if parked_already:
    sys.exit(f"ABORT before writes: {len(parked_already)} students are already parked - a previous run did not finish; run --restore")
load = sorted((int(LOAD_RE.fullmatch(r["full_name"] or "").group(1)), r["id"]) for r in active if LOAD_RE.fullmatch(r["full_name"] or ""))
others = [r for r in active if not LOAD_RE.fullmatch(r["full_name"] or "")]
have_lot = {x["student_id"] for x in lots_today()}
others_without_lot = [r for r in others if r["id"] not in have_lot]
print(f"staging before: {len(active)} active = {len(load)} synthetic load students + {len(others)} other students "
      f"(never written); production Scheduler budget = {BUDGET} tries", flush=True)
for r in others:
    print(f"  not written: {r['id']}  {r['full_name']}", flush=True)
if others_without_lot:
    sys.exit("ABORT before writes: these non-load students have no Lot today, so the job would write one for them: "
             + ", ".join(f"{r['id']} {r['full_name']}" for r in others_without_lot))
TARGET_N = N - len(others)
if TARGET_N < 200 or len(load) < TARGET_N:
    sys.exit(f"ABORT before writes: cannot form a 2,000 population ({len(load)} load students, {len(others)} others)")
target = [i for n, i in load[:TARGET_N]]
target_set = set(target)
to_park = [i for n, i in load[TARGET_N:]]
target_tasks = [x["id"] for x in lots_today() if x["student_id"] in target_set]
deps = {}
for t in DEPENDENTS:
    found = 0
    for k in range(0, len(target_tasks), 150):
        found += len(get(f"{t}?select=task_id&task_id=in.({','.join(target_tasks[k:k + 150])})"))
    deps[t] = found
print(f"  target: Load Student {load[0][0]}..{load[TARGET_N - 1][0]} ({TARGET_N}); to park: {len(to_park)} load students; "
      f"target Lots today: {len(target_tasks)}; dependent rows on them: {deps}", flush=True)
if any(deps.values()):
    sys.exit(f"ABORT before writes: target Lots of today have dependent rows {deps}; deleting them would destroy or unlink evidence")
fingerprint0 = student_fingerprint()
outside0 = outside_lots(target_set)

try:
    # 0. Snapshot every load student this run may write, then park the load students outside the target.
    sql(f"""do $p$ begin
  if to_regclass('release_test.park_2k') is not null then raise exception 'snapshot already exists - run --restore'; end if;
end $p$;
create schema release_test;
create table release_test.park_2k as
  select id, status, updated_at, preferred_skills from public.student_profiles where {LOAD_SQL} and status = 'active';
alter table release_test.park_2k add primary key (id);
alter table public.student_profiles disable trigger student_profiles_set_updated_at;
update public.student_profiles set status = '{PARK}' where status = 'active' and {LOAD_SQL} and {NUM} > {TARGET_N};
alter table public.student_profiles enable trigger student_profiles_set_updated_at;""")
    now_active = {r["id"] for r in get("student_profiles?select=id&status=eq.active")}
    check("population: the job sees exactly 2,000 active students (target load students + untouched others)",
          len(now_active) == N and target_set <= now_active and all(r["id"] in now_active for r in others),
          {"active": len(now_active), "target_load": TARGET_N, "untouched_others": len(others)})
    if len(now_active) != N:
        raise RuntimeError("population is not exactly 2,000 - stopping")

    def delete_target_lots():
        sql(f"""do $d$ declare n int; begin
  select count(*) into n from public.tasks t join public.student_profiles p on p.id = t.student_id
   where t.lot_date = current_date and p.status = 'active' and p.full_name ~ '^Load Student [0-9]+$' and substring(p.full_name from 14)::int <= {TARGET_N}
     and (exists (select 1 from public.task_submissions x where x.task_id = t.id) or exists (select 1 from public.task_assignments x where x.task_id = t.id)
       or exists (select 1 from public.voice_explanations x where x.task_id = t.id) or exists (select 1 from public.student_levels x where x.task_id = t.id));
  if n > 0 then raise exception 'refusing: % target Lots have dependent evidence', n; end if;
  delete from public.tasks t using public.student_profiles p
   where p.id = t.student_id and t.lot_date = current_date and p.status = 'active' and p.full_name ~ '^Load Student [0-9]+$' and substring(p.full_name from 14)::int <= {TARGET_N};
end $d$;""")

    def skills(ids, broken):
        expr = BROKEN if broken else "s.preferred_skills"
        sql(f"update public.student_profiles p set preferred_skills = {expr} from release_test.park_2k s "
            f"where p.id = s.id and p.id in ({ids_sql(ids)}) and p.full_name ~ '^Load Student [0-9]+$';")

    def got_lot(ids):
        return len(get(f"tasks?select=student_id&lot_date=eq.{today()}&student_id=in.({','.join(ids)})"))

    # A. healthy
    delete_target_lots()
    c, b, r = run_job("A healthy")
    s = lot_state(target_set)
    check(f"A. healthy -> success, HTTP 200, {TARGET_N} created, {len(others)} already had one", c == 200 and r.get("status") == "success"
          and r.get("failed") == 0 and r.get("lots_created") == TARGET_N and r.get("already_had_one") == len(others) and r.get("students") == N, {"http": c, **r})
    check("A. database: every target student has exactly one Lot today", s["with_lot"] == TARGET_N and s["missing"] == 0 and s["duplicates"] == 0, s)

    # B. re-run is idempotent
    c, b, r = run_job("B rerun")
    s = lot_state(target_set)
    check("B. re-run: success, 0 new Lots, all 2,000 already had one", c == 200 and r.get("status") == "success" and r.get("lots_created") == 0
          and r.get("already_had_one") == N, {"http": c, **r})
    check("B. database: unchanged, no duplicates", s["with_lot"] == TARGET_N and s["duplicates"] == 0, s)

    # C. 10 isolated bad-data students (first in the job's order)
    bad10 = target[:10]
    delete_target_lots(); skills(bad10, True)
    c, b, r = run_job("C 10 bad")
    s = lot_state(target_set)
    check("C. 10 bad -> partial_failure, HTTP 200, failed 10", c == 200 and r.get("status") == "partial_failure" and r.get("failed") == 10
          and r.get("lots_created") == TARGET_N - 10, {"http": c, **r})
    check("C. database: the healthy have a Lot, the 10 bad have none", s["with_lot"] == TARGET_N - 10 and got_lot(bad10) == 0 and s["duplicates"] == 0, s)

    # D. repair the 10
    skills(bad10, False)
    c, b, r = run_job("D repaired 10")
    s = lot_state(target_set)
    check("D. repaired 10 -> success, exactly 10 new Lots", c == 200 and r.get("status") == "success" and r.get("lots_created") == 10, {"http": c, **r})
    check("D. database: all target students have exactly one Lot", s["with_lot"] == TARGET_N and s["duplicates"] == 0 and got_lot(bad10) == 10, s)

    # E. 100 bad (over the 50-student failure line)
    bad100 = target[:100]
    delete_target_lots(); skills(bad100, True)
    c, b, r = run_job("E 100 bad")
    s = lot_state(target_set)
    check("E. 100 bad -> failure, HTTP 500, ok:false, failed 100", c == 500 and b.get("ok") is False and r.get("status") == "failure"
          and r.get("failed") == 100 and r.get("lots_created") == TARGET_N - 100, {"http": c, "ok": b.get("ok"), **r})
    check("E. database: the healthy still got their Lot", s["with_lot"] == TARGET_N - 100 and got_lot(bad100) == 0 and s["duplicates"] == 0, s)

    # F. repair the 100
    skills(bad100, False)
    c, b, r = run_job("F repaired 100")
    s = lot_state(target_set)
    check("F. repaired 100 -> success, exactly 100 new Lots", c == 200 and r.get("status") == "success" and r.get("lots_created") == 100, {"http": c, **r})
    check("F. database: all target students have exactly one Lot, none missing, no duplicates",
          s["with_lot"] == TARGET_N and s["missing"] == 0 and s["duplicates"] == 0, s)

    check(f"G. every run finished within production's Scheduler budget ({BUDGET} tries)", max(x["tries"] for x in runs) <= BUDGET,
          [(x["run"], x["tries"], x.get("seconds")) for x in runs])
    diff = compare(outside0, outside_lots(target_set))
    check("H. today's Lots outside the target: exact same set (added/removed/changed = 0)", diff == {"added": 0, "removed": 0, "changed": 0},
          {**diff, "outside_lots": len(outside0)})
finally:
    restore()
    fingerprint1 = student_fingerprint()
    changed = [k for k in fingerprint0 if fingerprint1.get(k) != fingerprint0[k]]
    check("I. cleanup: every student row (status, updated_at, skills) identical to before; snapshot removed",
          not changed and set(fingerprint1) == set(fingerprint0) and not get(f"student_profiles?select=id&status=eq.{PARK}"),
          {"students": len(fingerprint0), "changed": len(changed), "first_changed": changed[:3]})

os.makedirs(os.path.join("e2e-out", "final"), exist_ok=True)
json.dump({"runs": runs, "checks": results, "budget": BUDGET, "target_load": TARGET_N, "untouched_others": len(others)},
          open(os.path.join("e2e-out", "final", "daily-lots-2k.json"), "w"), indent=1)
print(f"\n{sum(r['ok'] for r in results)}/{len(results)} checks passed")
sys.exit(0 if results and all(r["ok"] for r in results) else 1)
