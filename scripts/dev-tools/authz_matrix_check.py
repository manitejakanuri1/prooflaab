"""Authorization matrix, PRODUCTION, read-only: signs in the dedicated TEST logins (student smoke01,
college, admin; company when prooflab-company-test-password + vidyuthsetu+company01 exist) and checks each
can reach only what it should. Every call is a read or a call that must be refused; nothing is changed
except by calls that are expected to FAIL (and are checked to have failed).
usage: python scripts/dev-tools/authz_matrix_check.py
"""
import json, subprocess, sys, urllib.error, urllib.request, shutil

KEY = "AIzaSyCNv0YWVP5QTDRb4WPVccmosCMC8cH7nnw"   # public browser key
BRIDGE = "https://prooflab-auth-bridge-ysn2mpe6sa-el.a.run.app"
API = "https://prooflab-api-ysn2mpe6sa-el.a.run.app"
FN = "https://prooflab-functions-135298577404.asia-south1.run.app/functions/v1"
WORKER = "https://prooflab-transcription-worker-ysn2mpe6sa-el.a.run.app"
LOGINS = {"student": ("vidyuthsetu+smoke01@gmail.com", "prooflab-smoke-student-password"),
          "college": ("vidyuthsetu+college@gmail.com", "prooflab-college-password"),
          "admin": ("vidyuthsetu@gmail.com", "prooflab-admin-password"),
          "company": ("vidyuthsetu+company01@gmail.com", "prooflab-company-test-password")}
G = shutil.which("gcloud") or shutil.which("gcloud.cmd")
rows = []

def http(method, url, body=None, token=None, prefer=None):
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = f"Bearer {token}"
    if prefer: h["Prefer"] = prefer
    r = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            t = x.read().decode(); return x.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try: return e.code, json.loads(t)
        except Exception: return e.code, t

def token(who):
    email, sec = LOGINS[who]
    pw = subprocess.run([G, "secrets", "versions", "access", "latest", f"--secret={sec}"], capture_output=True, text=True).stdout.strip()
    if not pw: return None
    st, j = http("POST", f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={KEY}",
                 {"email": email, "password": pw, "returnSecureToken": True})
    if st != 200: return None
    st, t = http("POST", f"{BRIDGE}/token", {}, j["idToken"])
    return t["access_token"] if st == 200 else None

def rec(area, what, role, expect, got, ok):
    rows.append((area, what, role, expect, got, ok))
    print(f"{'PASS' if ok else 'FAIL'}  {role:8} {what:58} expect {expect:10} got {got}")

T = {w: token(w) for w in LOGINS}
print("signed in:", {w: bool(t) for w, t in T.items()})
me = {}
for w in ("student", "college", "admin"):
    if T[w]:
        st, o = http("GET", f"{API}/user_roles?select=user_id,role", None, T[w]); me[w] = o
denied = lambda st: st in (401, 403, 404)

# --- student
s = T["student"]
st, o = http("GET", f"{API}/student_profiles?select=id", None, s)
rec("PostgREST", "student_profiles visible rows", "student", "only self", f"{len(o) if isinstance(o, list) else st}", isinstance(o, list) and len(o) == 1)
for t in ("task_submissions", "voice_explanations", "tasks"):
    st, o = http("GET", f"{API}/{t}?select=student_id", None, s)
    others = [r for r in o if r["student_id"] != "366602c7-90a0-4f3b-8956-82ed35c0dd15"] if isinstance(o, list) else ["err"]
    rec("PostgREST", f"{t}: other students' rows", "student", "0", f"{len(others)} of {len(o) if isinstance(o, list) else st}", not others)
st, o = http("GET", f"{API}/student_contact?select=student_id", None, s)
rec("PostgREST", "student_contact: other students", "student", "0", str(len([r for r in o if r['student_id'] != '366602c7-90a0-4f3b-8956-82ed35c0dd15']) if isinstance(o, list) else st),
    isinstance(o, list) and all(r["student_id"] == "366602c7-90a0-4f3b-8956-82ed35c0dd15" for r in o) or denied(st))
for rpc in ("admin_trace_search", "admin_bug_finder_runs", "tpo_placement_report"):
    st, o = http("POST", f"{API}/rpc/{rpc}", {}, s)
    rec("RPC", f"{rpc} (admin/college only)", "student", "denied", str(st), denied(st) or (st == 200 and not o) or (st == 400))
for rpc in ("claim_transcription_job", "claim_transcription_recovery", "complete_voice_scoring", "record_task_submission"):
    st, o = http("POST", f"{API}/rpc/{rpc}", {}, s)
    rec("RPC", f"{rpc} (server only)", "student", "denied", str(st), denied(st))
st, o = http("PATCH", f"{API}/voice_explanations?student_id=eq.366602c7-90a0-4f3b-8956-82ed35c0dd15", {"communication_score": 100}, s)
rec("PostgREST", "update own voice score", "student", "denied", str(st), denied(st))
st, o = http("PATCH", f"{API}/task_rubric_config?id=eq.ad5f2c83-558b-4bdc-a0d6-53c6e552e8ee", {"scratch_language": "java"}, s, "return=representation")
rec("PostgREST", "change a task's scratch_language", "student", "0 rows", f"{st} {len(o) if isinstance(o, list) else ''}", denied(st) or (isinstance(o, list) and not o))
for f in ("create-student-users", "create-college-user"):
    st, o = http("POST", f"{FN}/{f}", {"students": [], "college_id": "00000000-0000-0000-0000-000000000000"}, s)
    rec("Function", f"{f} (college/admin only)", "student", "denied", str(st), st in (401, 403))
st, o = http("POST", f"{WORKER}/transcribe-job", {"voice_id": "00000000-0000-0000-0000-000000000000"}, s)
rec("Worker", "private worker with a student ticket", "student", "401/403", str(st), st in (401, 403))

# --- college
c = T["college"]
if c:
    st, o = http("GET", f"{API}/student_profiles?select=id,college_id", None, c)
    cols = {r["college_id"] for r in o} if isinstance(o, list) else {"err"}
    rec("PostgREST", "student_profiles: only own college", "college", "1 college", f"{len(o) if isinstance(o, list) else st} rows, colleges {len(cols)}", isinstance(o, list) and len(cols) <= 1)
    st, o = http("POST", f"{API}/rpc/admin_trace_search", {}, c)
    rec("RPC", "admin_trace_search (admin only)", "college", "denied", str(st), denied(st) or st == 400)
    st, o = http("PATCH", f"{API}/task_rubric_config?id=eq.ad5f2c83-558b-4bdc-a0d6-53c6e552e8ee", {"scratch_language": "java"}, c, "return=representation")
    rec("PostgREST", "change a task's scratch_language", "college", "0 rows", f"{st} {len(o) if isinstance(o, list) else ''}", denied(st) or (isinstance(o, list) and not o))
    st, o = http("GET", f"{API}/voice_explanations?select=id&student_id=eq.366602c7-90a0-4f3b-8956-82ed35c0dd15", None, c)
    rec("PostgREST", "read a student's voice rows (own college)", "college", "allowed", f"{st} {len(o) if isinstance(o, list) else ''}", st == 200)

# --- admin
a = T["admin"]
if a:
    st, o = http("POST", f"{API}/rpc/admin_bug_finder_runs", {}, a)
    rec("RPC", "admin_bug_finder_runs", "admin", "allowed", str(st), st == 200)
    st, o = http("GET", f"{API}/task_rubric_config?select=id&limit=1", None, a)
    rec("PostgREST", "read task_rubric_config", "admin", "allowed", f"{st} {len(o) if isinstance(o, list) else ''}", st == 200 and bool(o))
    st, o = http("POST", f"{API}/rpc/claim_transcription_job", {}, a)
    rec("RPC", "claim_transcription_job (server only)", "admin", "denied", str(st), denied(st))

# --- company (verified TEST company, vidyuthsetu+company01)
co = T["company"]
if not co:
    rec("Company", "company test login", "company", "exists", "NOT CREATED (owner command 5)", False)
else:
    st, o = http("GET", f"{API}/user_roles?select=role", None, co)
    rec("PostgREST", "own role is company (startup)", "company", "startup", str(o), isinstance(o, list) and [r["role"] for r in o] == ["startup"])
    st, o = http("POST", f"{API}/rpc/is_verified_recruiter", {}, co)
    rec("RPC", "is a verified company", "company", "true", str(o), o is True)
    for t in ("student_profiles", "student_contact", "voice_explanations", "task_submissions", "tasks", "resume_claims",
              "resume_scorecards", "colleges", "student_imports", "recruiter_links", "task_rubric_config", "notifications"):
        st, o = http("GET", f"{API}/{t}?select=*&limit=50", None, co)
        rec("PostgREST", f"{t}: rows visible", "company", "0 / denied", f"{st} {len(o) if isinstance(o, list) else ''}",
            denied(st) or (isinstance(o, list) and not o))
    for t in ("app_events", "removed_students"):
        st, o = http("GET", f"{API}/{t}?select=*&limit=1", None, co)
        rec("PostgREST", f"{t} (admin/server only)", "company", "denied", str(st), denied(st) or (isinstance(o, list) and not o))
    for rpc in ("admin_trace_search", "admin_bug_finder_runs"):
        st, o = http("POST", f"{API}/rpc/{rpc}", {}, co)
        rec("RPC", f"{rpc} (admin only)", "company", "denied", str(st), denied(st) or st == 400)
    for rpc in ("tpo_placement_report", "tpo_college_report"):
        st, o = http("POST", f"{API}/rpc/{rpc}", {}, co)
        rec("RPC", f"{rpc} (college only)", "company", "refused", f"{st} {str(o)[:40]}",
            denied(st) or st == 400 or (isinstance(o, dict) and "error" in o))
    for rpc in ("claim_transcription_job", "record_task_submission", "complete_voice_scoring"):
        st, o = http("POST", f"{API}/rpc/{rpc}", {}, co)
        rec("RPC", f"{rpc} (server only)", "company", "denied", str(st), denied(st))
    st, o = http("POST", f"{API}/rpc/recruiter_proof_profile", {"_student_id": "366602c7-90a0-4f3b-8956-82ed35c0dd15"}, co)
    rec("RPC", "proof profile of a non-public student", "company", "no data", str(o)[:40], not (isinstance(o, dict) and o.get("full_name")))
    st, o = http("POST", f"{API}/rpc/recruiter_talent", {}, co)
    rec("RPC", "talent search runs (public students only)", "company", "allowed", f"{st} {len(o) if isinstance(o, list) else ''}", st == 200 and isinstance(o, list))
    st, o = http("PATCH", f"{API}/task_rubric_config?id=eq.ad5f2c83-558b-4bdc-a0d6-53c6e552e8ee", {"scratch_language": "java"}, co, "return=representation")
    rec("PostgREST", "change a task's scratch_language", "company", "0 rows", f"{st} {len(o) if isinstance(o, list) else ''}", denied(st) or (isinstance(o, list) and not o))
    for f in ("create-student-users", "create-college-user"):
        st, o = http("POST", f"{FN}/{f}", {"students": [], "college_id": "00000000-0000-0000-0000-000000000000"}, co)
        rec("Function", f"{f} (college/admin only)", "company", "denied", str(st), st in (401, 403))
    st, o = http("POST", f"{WORKER}/transcribe-job", {"voice_id": "00000000-0000-0000-0000-000000000000"}, co)
    rec("Worker", "private worker with a company ticket", "company", "401/403", str(st), st in (401, 403))

bad = [r for r in rows if not r[5]]
json.dump(rows, open("authz_matrix_results.json", "w"))
print(f"\n{len(rows) - len(bad)}/{len(rows)} passed" + (f"; failed: {[r[1] + ' / ' + r[2] for r in bad]}" if bad else ""))
