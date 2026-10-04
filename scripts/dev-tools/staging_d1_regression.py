"""STAGING ONLY. After migration 80: the backend paths that use the now server-only functions still
work, and leave the right rows. About 1-2 written AI gradings (well under Rs 1).

    python scripts/dev-tools/staging_d1_regression.py

Synthetic students only (Load Student 14603-14606); every task it creates is titled 'AUDIT D1 ...'.
"""
import json, os, sys, time, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:300], flush=True)


def task(student, title, **cfg):
    c, b = st.call("svc", "POST", "tasks", {"student_id": student, "title": title, "description": "D1 regression", "category": "technical",
                                            "status": "pending", "source": "lot", "lot_category": "technical", "difficulty": "Easy", **cfg})
    assert c == 201, (c, b)
    return b[0]["id"]


t0 = time.time()
# 1. Backend (service key) reads of server-only functions.
c, b = st.call("svc", "RPC", "account_id_for_email", {"_email": "e2e.admin@staging.prooflab.invalid"})
check("account lookup (service key) still works", c == 200 and b == "ffed80fc-08ee-4cce-ac54-9432ef2d81f9", (c, b))
c, b = st.call("svc", "RPC", "check_rate_limit", {"p_bucket": "d1-regression", "p_subject": "probe", "p_limit": 100, "p_window_seconds": 60})
check("rate-limit counter (service key) still works", c == 200, (c, str(b)[:100]))
c, b = st.call("svc", "RPC", "student_logins", {})
check("student_logins (service key, accounts robot) still works", c == 200 and isinstance(b, list), (c, str(b)[:80]))

# 2. Coding Submit through the backend.
G = "3545a46b-a17f-4f2e-8788-35ada1b5e699"
cfg = st.call("svc", "GET", f"task_sandbox_config?select=reference_solution,test_cases&id=eq.{G}")[1][0]
S1 = "10ad0000-0000-4000-8000-000000014603"
t1 = task(S1, "AUDIT D1 coding submit", sandbox_config_id=G)
xp0 = st.call("svc", "GET", f"student_profiles?select=total_xp&id=eq.{S1}")[1][0]["total_xp"]
c, b = st.call(f"user:{S1}", "FN", "submit-sandbox-task", {"task_id": t1, "code": cfg["reference_solution"]})
row = st.call("svc", "GET", f"task_submissions?select=student_id,task_id,status,sandbox_score,runner&task_id=eq.{t1}")[1]
tk = st.call("svc", "GET", f"tasks?select=status&id=eq.{t1}")[1][0]
hidden = [x["expected_output"].strip() for x in cfg["test_cases"] if not x["visible"] and len(x["expected_output"].strip()) > 1]
check("coding Submit: passed 100, stored once for the right student and task, task completed, no hidden data",
      c == 200 and b.get("passed") and len(row) == 1 and row[0]["student_id"] == S1 and row[0]["sandbox_score"] == 100
      and row[0]["status"] == "passed" and tk["status"] == "completed" and not any(h in json.dumps(b) for h in hidden),
      (c, row, tk, xp0))

# 3. Written Submit through the backend (similar_written_submission + record_task_submission).
RUB = "c1b169dd-8da6-4a80-8915-f303632b4e0c"
ans = ("# remove log files that are older than a week from this folder\nfind . -name '*.log' -mtime +7 -delete\n"
       "# put the remaining log files into one compressed archive\ntar -czf old_logs_backup.tar.gz *.log\n"
       "# show what went into the archive to be sure it worked\ntar -tzf old_logs_backup.tar.gz\n"
       "I check the listing before telling the team that the folder is clean.")
S2 = "10ad0000-0000-4000-8000-000000014604"
t2 = task(S2, "AUDIT D1 written submit", rubric_config_id=RUB)
c, b = st.call(f"user:{S2}", "FN", "submit-written-task", {"task_id": t2, "answer": ans})
row = st.call("svc", "GET", f"task_submissions?select=student_id,status,sandbox_score,rubric_scores,flags&task_id=eq.{t2}")[1]
check("written Submit: graded with per-criterion points, stored for the right student",
      c == 200 and len(row) == 1 and row[0]["student_id"] == S2 and len(row[0]["rubric_scores"] or []) == 4 and b.get("score") == row[0]["sandbox_score"],
      (c, b.get("score"), b.get("status"), row[:1]))

# 4. Topic attempt (record_topic_attempt) through the backend's own call, as level-quiz-submit makes it.
S3 = "10ad0000-0000-4000-8000-000000014605"
c, b = st.call("svc", "RPC", "record_topic_attempt", {"_student_id": S3, "_topic": "python", "_outcome": "correct", "_level_id": None, "_seconds": None})
rt = st.call("svc", "GET", f"topic_ratings?select=*&student_id=eq.{S3}")
check("topic attempt (service key, as level-quiz-submit calls it) writes the rating", c in (200, 204) and rt[0] == 200 and len(rt[1]) >= 1, (c, str(b)[:80], str(rt)[:160]))

# 5. Scheduled jobs the release gate does not already run.
for job in ("extend-fixtures", "weekly-progress", "weekly-plan"):
    req = urllib.request.Request(f"{st.FUNCTIONS}/scheduled-job?job={job}", data=b"{}", method="POST", headers=st.scheduler_headers())
    try:
        with urllib.request.urlopen(req, timeout=320) as r:
            status, body = r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        status, body = e.code, e.read().decode()[:200]
    check(f"scheduled job {job} still runs", status == 200 and isinstance(body, dict) and body.get("ok") is True, (status, str(body)[:200]))

# 6. No "permission denied" anywhere in staging server logs since this script started.
since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t0 - 5))
import subprocess
log = subprocess.run(f'gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name:staging AND timestamp>=\\"{since}\\" '
                     f'AND (textPayload:\\"permission denied\\" OR jsonPayload.message:\\"permission denied\\")" --project=prooflab-508214 --limit=10 '
                     f'--format="value(resource.labels.service_name,jsonPayload.message,textPayload)"', shell=True, capture_output=True, text=True).stdout.strip()
check("no 'permission denied' in staging server logs during these flows", log == "", log[:300])

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
