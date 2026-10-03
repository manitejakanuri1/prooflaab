"""STAGING ONLY. Times the queries behind every main screen, and the nightly jobs, against the
15,000-student synthetic dataset (staging_loadset.sql). Staging runs on the smallest database
tier (db-f1-micro) with a pool of 2, so these numbers are a conservative lower bound.

    python scripts/dev-tools/staging_scale_check.py [--jobs]

A screen query over 1,500 ms, or any error, is a FAIL. --jobs also runs the nightly jobs
(squads, daily Lots, weekly seasons) once each; they write only synthetic staging rows.
"""
import json, os, statistics, subprocess, sys, time, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

TPO = "user:10adc011-0000-4000-8000-000000000001"
COLLEGE = "10adc011-0000-4000-9000-000000000001"
STUDENT_ID = "10ad0000-0000-4000-8000-000000000011"
STUDENT = f"user:{STUDENT_ID}"
ADMIN = "user:ffed80fc-08ee-4cce-ac54-9432ef2d81f9"
COMPANY = "user:b19ab84b-2ebe-4dc8-8a51-470b2193168e"
LIMIT_MS = 1500
tokens = {}


def call(who, verb, path, body=None, prefer=None):
    tokens.setdefault(who, st.token(who, ttl=3000))
    url = f"{st.API}/rpc/{path}" if verb == "RPC" else f"{st.API}/{path}"
    req = urllib.request.Request(url, data=json.dumps(body or {}).encode() if verb == "RPC" else None,
                                 method="POST" if verb == "RPC" else "GET",
                                 headers={"Authorization": f"Bearer {tokens[who]}", "Content-Type": "application/json",
                                          **({"Prefer": prefer} if prefer else {})})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return r.status, (time.perf_counter() - t0) * 1000, raw, r.headers.get("Content-Range")
    except urllib.error.HTTPError as e:
        return e.code, (time.perf_counter() - t0) * 1000, e.read(), None


CASES = [
    # (screen, who, verb, path, body, prefer)
    ("College: students page 1 (50 of 1,500)", TPO, "RPC", "tpo_students", {"_limit": 50}, None),
    ("College: students search by name", TPO, "RPC", "tpo_students", {"_search": "Student 77", "_limit": 50}, None),
    ("College: students filter 'needs attention'", TPO, "RPC", "tpo_students", {"_status": "attention", "_limit": 50}, None),
    ("College: attention list (bell + home)", TPO, "RPC", "tpo_attention", {}, None),
    ("College: one student profile", TPO, "RPC", "tpo_student_profile", {"_student_id": STUDENT_ID}, None),
    ("College: squads list", TPO, "GET", f"squads?select=*&college_id=eq.{COLLEGE}&order=points.desc&limit=200", None, None),
    ("College: squad performance (8 weeks)", TPO, "RPC", "tpo_squad_performance", {"_weeks": 8}, None),
    ("Student: today's Lot", STUDENT, "GET", f"tasks?select=*&student_id=eq.{STUDENT_ID}&lot_date=eq.{time.strftime('%Y-%m-%d')}", None, None),
    ("Student: all my tasks", STUDENT, "GET", f"tasks?select=id,title,status,lot_date,sandbox_config_id,rubric_config_id,started_at&student_id=eq.{STUDENT_ID}&order=created_at.desc", None, None),
    ("Student: Build-log submissions", STUDENT, "GET", f"task_submissions?select=id,task_id,status,sandbox_score,created_at,tasks(title,lot_date)&student_id=eq.{STUDENT_ID}&order=created_at.desc&limit=200", None, None),
    ("Student: Build-log recordings", STUDENT, "GET", f"voice_explanations?select=id,task_id,submission_id,status,communication_score,created_at&student_id=eq.{STUDENT_ID}&order=created_at.desc&limit=200", None, None),
    ("Student: my squad members", STUDENT, "RPC", "my_squad_members", {}, None),
    ("Student: leaderboard (top 100 of my college)", STUDENT, "RPC", "get_leaderboard", {"_limit": 100}, None),
    ("Student: my portfolio work", STUDENT, "RPC", "portfolio_work", {"_student_id": STUDENT_ID}, None),
    ("Admin: latest 200 submissions with names", ADMIN, "GET", "task_submissions?select=id,status,sandbox_score,created_at,tasks(title,source),student_profiles(full_name)&order=created_at.desc&limit=200", None, None),
    ("Admin: count all submissions", ADMIN, "GET", "task_submissions?select=id&limit=1", None, "count=exact"),
    ("Admin: count submissions needing review", ADMIN, "GET", "task_submissions?select=id&status=eq.needs_review&limit=1", None, "count=exact"),
    ("Admin: students list page (50)", ADMIN, "GET", "student_profiles?select=id,full_name,branch,total_xp,last_active,status,created_at,colleges(name),task_submissions(count)&order=created_at.desc&limit=50", None, "count=exact"),
    ("Admin: flagged submissions", ADMIN, "GET", "task_submissions?select=id,status,flags,created_at&flags=neq.{}&order=created_at.desc&limit=100", None, None),
    ("Company: talent search page (50)", COMPANY, "RPC", "recruiter_talent", {"_limit": 50}, None),
    ("Company: talent filtered by branch + skill", COMPANY, "RPC", "recruiter_talent", {"_branch": "CSE", "_skills": ["python"], "_limit": 50}, None),
    ("Company: home", COMPANY, "RPC", "recruiter_home", {}, None),
    ("Company: submissions on my Lots", COMPANY, "RPC", "company_submissions", {}, None),
]

results = []
print(f"{'screen query':52s} {'median':>8s} {'max':>8s}  rows/bytes")
for name, who, verb, path, body, prefer in CASES:
    times, status, size, rng = [], 0, 0, None
    for _ in range(3):
        status, ms, raw, rng = call(who, verb, path, body, prefer)
        times.append(ms)
        size = len(raw)
        if status >= 400:
            break
    med = statistics.median(times)
    ok = status < 400 and med <= LIMIT_MS
    results.append(ok)
    extra = (f" total={rng.split('/')[-1]}" if rng and prefer else "") + (f"  HTTP {status}: {raw[:120]!r}" if status >= 400 else "")
    print(("PASS " if ok else "FAIL ") + f"{name:47s} {med:7.0f}ms {max(times):7.0f}ms  {size:>7d} B{extra}", flush=True)

if "--jobs" in sys.argv:
    print("\nnightly jobs at 15,000 students (limit 240 s each - the function's request timeout is 300 s)")
    for job in ("nightly-squads", "daily-lots", "weekly-seasons", "prune-events"):
        req = urllib.request.Request(f"{st.FUNCTIONS}/scheduled-job?job={job}", data=b"{}", method="POST",
                                     headers=st.scheduler_headers())
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=320) as r:
                status, body = r.status, r.read().decode()[:160]
        except urllib.error.HTTPError as e:
            status, body = e.code, e.read().decode()[:160]
        except Exception as e:  # timeout
            status, body = 0, str(e)[:160]
        secs = time.perf_counter() - t0
        ok = status == 200 and secs <= 240
        results.append(ok)
        print(("PASS " if ok else "FAIL ") + f"{job:20s} {secs:6.1f}s  HTTP {status}  {body}", flush=True)

print(f"\n{sum(results)}/{len(results)} within limits")
sys.exit(0 if all(results) else 1)
