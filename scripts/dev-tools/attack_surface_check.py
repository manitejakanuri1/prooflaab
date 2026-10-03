"""Negative tests against every public ProofLab endpoint (production by default). No credentials:
every call is anonymous or uses an obviously fake token, so nothing can be read or changed.
Checks: protected calls refuse (401/403/empty), no stack traces or secrets in error bodies.
usage: python scripts/dev-tools/attack_surface_check.py
"""
import json, re, sys, urllib.error, urllib.request

API = "https://prooflab-api-ysn2mpe6sa-el.a.run.app"
FN = "https://prooflab-functions-135298577404.asia-south1.run.app"
SVC = {
    "auth-bridge": "https://prooflab-auth-bridge-ysn2mpe6sa-el.a.run.app",
    "files": "https://prooflab-files-135298577404.asia-south1.run.app",
    "accounts": "https://prooflab-accounts-135298577404.asia-south1.run.app",
    "transcriber": "https://prooflab-transcriber-135298577404.asia-south1.run.app",
    "code-runner": "https://prooflab-code-runner-ysn2mpe6sa-el.a.run.app",
}
FAKE = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake-signature"
LEAK = re.compile(r"Traceback|at \w+ \(|file:///|/app/|stack|PGRST_JWT|SECRET|password|BEGIN PRIVATE|postgres://", re.I)
results = []

def req(method, url, body=None, headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {"Content-Type": "application/json", **(headers or {})}
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as x:
            return x.status, x.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)

def check(name, status, body, ok_codes, allow_empty_200=False):
    empty = status == 200 and body.strip() in ("[]", "")
    good = status in ok_codes or (allow_empty_200 and empty)
    leak = bool(LEAK.search(body))
    results.append((name, good and not leak))
    print(f"{'PASS' if good and not leak else 'FAIL'}  {name:62} -> {status} {'(empty)' if empty else ''}{' LEAK!' if leak else ''} {body[:70]!r}")

# PostgREST: anonymous must not read private tables or call server-only RPCs
for t in ["student_profiles", "student_contact", "task_submissions", "voice_explanations", "resume_claims",
          "task_rubric_config", "task_sandbox_config", "user_roles", "app_events", "llm_usage", "removed_students"]:
    s, b = req("GET", f"{API}/{t}?select=*&limit=1")
    check(f"api anon read {t}", s, b, (401, 403, 404), allow_empty_200=True)
for rpc in ["claim_transcription_job", "complete_transcription_job", "claim_transcription_recovery",
            "complete_voice_scoring", "record_task_submission", "remove_students", "admin_trace_search"]:
    s, b = req("POST", f"{API}/rpc/{rpc}", {})
    check(f"api anon rpc {rpc}", s, b, (401, 403, 404))
s, b = req("GET", f"{API}/voice_explanations?select=id&limit=1", headers={"Authorization": FAKE})
check("api forged service_role token", s, b, (401, 403))

# Functions: login-only functions refuse anonymous and forged callers
for f in ["submit-written-task", "submit-sandbox-task", "run-code", "run-sandbox", "voice-score", "transcription-enqueue",
          "levels-place", "level-open", "task-explain", "lot-writer", "create-student-users", "create-college-user",
          "resume-improve", "mock-interview-generate", "app-guide-chat"]:
    s, b = req("POST", f"{FN}/functions/v1/{f}", {})
    check(f"functions anon {f}", s, b, (400, 401, 403))
    s, b = req("POST", f"{FN}/functions/v1/{f}", {}, {"Authorization": FAKE})
    check(f"functions forged token {f}", s, b, (400, 401, 403))
for f in ["scheduled-job?job=daily-lots", "transcription-reap"]:
    s, b = req("POST", f"{FN}/{f}", {})
    check(f"functions no webhook secret {f}", s, b, (401, 403))
    s, b = req("POST", f"{FN}/{f}", {}, {"x-webhook-secret": "wrong"})
    check(f"functions wrong webhook secret {f}", s, b, (401, 403))
s, b = req("POST", f"{FN}/functions/v1/submit-written-task", raw=b"{not json", headers={"Authorization": FAKE})
check("functions malformed body: no stack trace", s, b, (400, 401, 403, 500))
s, b = req("GET", f"{FN}/functions/v1/does-not-exist")
check("functions unknown route", s, b, (401, 404))

# Other services
s, b = req("POST", f"{SVC['auth-bridge']}/token", {})
check("auth-bridge token without Google login", s, b, (400, 401, 403))
s, b = req("POST", f"{SVC['auth-bridge']}/token", {}, {"Authorization": FAKE})
check("auth-bridge token with forged login", s, b, (400, 401, 403))
s, b = req("PUT", f"{SVC['files']}/file/voice-explanations/x/test.webm", raw=b"x", headers={"Content-Type": "audio/webm"})
check("files anon upload", s, b, (401, 403))
s, b = req("GET", f"{SVC['files']}/file/voice-explanations/x/test.webm")
check("files anon read private object", s, b, (401, 403, 404))
for p in ["/remove", "/sync", "/password-link"]:
    s, b = req("POST", f"{SVC['accounts']}{p}", {})
    check(f"accounts anon {p}", s, b, (401, 403))
s, b = req("POST", f"{SVC['transcriber']}/transcribe", raw=b"x", headers={"Content-Type": "audio/wav"})
check("transcriber anon", s, b, (401, 403))
s, b = req("POST", f"{SVC['code-runner']}/run", {"language": "python", "code": "print(1)"})
check("code-runner without runner secret", s, b, (401, 403))

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)}/{len(results)} passed" + (f"; FAILED: {bad}" if bad else ""))
sys.exit(1 if bad else 0)
