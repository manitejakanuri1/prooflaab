"""STAGING ONLY. Daily-Lot status semantics (G6, migration 75): success / partial_failure / failure,
and a failure is a non-success HTTP answer. Uses synthetic load-test students only: their skills
field is made unusable (the exact thing that broke the job at scale), the job is run, and the
field is put back.

    python scripts/dev-tools/staging_daily_lots_status_check.py
"""
import json, os, subprocess, sys, tempfile, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:230], flush=True)


def sql(text):
    f = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8", newline="\n")
    f.write("select set_config('app.system_write','on',false);\n" + text.rstrip() + "\n"); f.close()
    r = subprocess.run(["bash", "scripts/dev-tools/staging_sql.sh", f.name.replace("\\", "/")], capture_output=True, text=True)
    assert "exit=0" in r.stdout, r.stdout[-400:]




def run_once():
    req = urllib.request.Request(f"{st.FUNCTIONS}/scheduled-job?job=daily-lots", data=b"{}", method="POST",
                                 headers=st.scheduler_headers())
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def production_attempt_budget():
    """How many tries production's Cloud Scheduler gives daily-lots: 1 + retryCount (read-only, live)."""
    out = subprocess.run("gcloud scheduler jobs describe prooflab-daily-lots --location=asia-south1 --project=prooflab-508214 "
                         "--format=value(retryConfig.retryCount)", shell=True, capture_output=True, text=True).stdout.strip()
    return 1 + int(out) if out.isdigit() else 1


BUDGET = production_attempt_budget()
TRIES = []


def run_job():
    """As Cloud Scheduler does it: a run that stopped at its own time limit ("ran out of time
    ... the retry continues") is retried, and the retry carries on where it stopped.
    Lots created by the stopped runs are added to the final answer.
    Correctness is judged on the FINISHED job, however many tries the 15,000-student data set needs (up to 10);
    the number of tries is recorded and judged separately against production's Scheduler budget (scale)."""
    made = 0
    for n in range(1, 11):
        c, b = run_once()
        m = __import__("re").search(r"\((\d+) Lots created\); the retry continues", str(b.get("error") or ""))
        if c == 500 and m:
            made += int(m.group(1)); print("  (run stopped at its time limit; retrying as Scheduler would)", flush=True)
            continue
        if made and isinstance(b.get("result"), dict):
            b["result"]["lots_created"] = b["result"].get("lots_created", 0) + made
        TRIES.append(n)
        return c, b
    TRIES.append(99)
    return c, b


BROKEN = "array[array['x','y']]"      # a two-dimensional skills array makes create_lot_for() raise
WHERE = "full_name like 'Load Student %' and substring(full_name from 14)::int"
FIX = "string_to_array((array['python,sql','javascript,react','java,dsa','linux,docker'])[1 + substring(full_name from 14)::int % 4], ',')"
today = "delete from public.tasks where lot_date = current_date and student_id in (select id from public.student_profiles where full_name like 'Load Student %');\n"

try:
    # 1. Everyone fine.
    sql(today)
    c, b = run_job(); r = b.get("result") or {}
    check("all students fine -> success, HTTP 200", c == 200 and r.get("status") == "success" and r.get("failed") == 0 and r.get("lots_created", 0) >= 15000, (c, {k: r.get(k) for k in ("status", "failed", "lots_created")}))

    # 2. Ten students broken (under 5% and under 50) -> partial_failure, still HTTP 200, others get Lots.
    sql(today + f"update public.student_profiles set preferred_skills = {BROKEN} where {WHERE} between 1 and 10;")
    c, b = run_job(); r = b.get("result") or {}
    check("10 of 15,000 fail -> partial_failure, HTTP 200, the rest get their Lot", c == 200 and r.get("status") == "partial_failure" and r.get("failed") == 10 and r.get("lots_created", 0) >= 14990, (c, {k: r.get(k) for k in ("status", "failed", "lots_created")}))

    # 3. Two thousand broken -> failure, HTTP 500 (Scheduler retries, alert fires); the healthy ones still got Lots.
    sql(today + f"update public.student_profiles set preferred_skills = {BROKEN} where {WHERE} between 1 and 2000;")
    c, b = run_job(); r = b.get("result") or {}
    check("2,000 fail -> failure, HTTP 500, ok:false", c == 500 and b.get("ok") is False and r.get("status") == "failure" and r.get("failed") == 2000, (c, b.get("ok"), {k: r.get(k) for k in ("status", "failed", "lots_created")}))
    check("even then the 13,000 healthy students got their Lot", r.get("lots_created", 0) >= 13000, r.get("lots_created"))
finally:
    sql(f"update public.student_profiles set preferred_skills = {FIX} where {WHERE} between 1 and 2000;")

c, b = run_job(); r = b.get("result") or {}
check("after the data is repaired the retry completes: success", c == 200 and r.get("status") == "success" and r.get("lots_created") == 2000, (c, {k: r.get(k) for k in ("status", "failed", "lots_created")}))

check(f"scale: every run finished within production's Scheduler budget ({BUDGET} tries)", max(TRIES or [99]) <= BUDGET,
      f"tries per run: {TRIES} (15,000 synthetic students; release target 2,000)")
print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
