"""STAGING ONLY. Cross-account checks for the server functions (F2 groundwork).

Every function below runs with full database rights on the server, so the only thing
standing between one student and another student's data is the function's own check.
This calls each one as an INTRUDER (a student at another college, and where relevant a
company or nobody at all) using the VICTIM's ids, and expects a refusal - never a 200,
and never an AI call. Nothing here should change data: every call is expected to fail.

    python scripts/dev-tools/staging_function_authz_check.py
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

VICTIM = "99999999-0001-0000-0000-000000000001"           # Fake Student 1 (College A)
INTRUDER = f"user:3d99656a-950f-4bb8-ab75-e97317e68542"   # Student B (College B)
COMPANY = "user:b19ab84b-2ebe-4dc8-8a51-470b2193168e"
CODE_TASK = "e4e25563-6072-42a7-8c8a-79efce3bb649"
WRITTEN_TASK = "b1f20882-34ff-4701-adab-60cc6c1444e5"
CLAIMS = "c6fad6d6-a7cb-4385-b704-2c3735aed40d"
ASSESSMENT = "30163808-ad9f-42b2-a0c1-073aac06f641"
VOICE = "df5a9722-a6b4-4a72-9a93-7d4c9a29dcd6"
NOBODY_UUID = "00000000-0000-4000-8000-000000000000"
RETIRED = ["ai-authorship", "github-check", "leetcode-streak-sync", "proof-file-url", "question-generator",
           "response-evaluator", "submit-conceptual-answers", "trust-compute", "verify-proof"]

# (function, body, who, why)
CASES = [
    ("submit-sandbox-task", {"task_id": CODE_TASK, "code": "print(1)"}, INTRUDER, "submit code on another student's task"),
    ("submit-written-task", {"task_id": WRITTEN_TASK, "answer": "x " * 80}, INTRUDER, "submit an answer on another student's task"),
    ("run-sandbox", {"task_id": CODE_TASK, "code": "print(1)"}, INTRUDER, "run another student's task tests"),
    ("run-sandbox", {"sandbox_config_id": "452e588c-42b6-4f55-bf5c-b7090cad2a09", "reference": True}, INTRUDER, "admin-only reference check"),
    ("task-explain", {"task_id": CODE_TASK}, INTRUDER, "read another student's task"),
    ("task-explain", {"lot_template_id": NOBODY_UUID}, INTRUDER, "admin-only template explain"),
    ("voice-score", {"voice_id": VOICE}, INTRUDER, "score another student's recording"),
    ("transcription-enqueue", {"storage_path": f"{VICTIM}/x.webm", "task_id": CODE_TASK, "idempotency_key": "authz-1"}, INTRUDER, "enqueue audio from another student's folder"),
    ("transcription-enqueue", {"storage_path": "3d99656a-950f-4bb8-ab75-e97317e68542/x.webm", "task_id": CODE_TASK, "idempotency_key": "authz-2"}, INTRUDER, "attach own audio to another student's task"),
    ("resume-code-execute", {"assessment_id": ASSESSMENT, "question_id": "q1", "code": "print(1)", "mode": "run"}, INTRUDER, "run on another student's resume round"),
    ("resume-assessment-submit", {"assessment_id": ASSESSMENT, "answers": [{"question_id": "q1", "answer": "a"}]}, INTRUDER, "submit another student's resume test"),
    ("resume-improve", {"resume_claims_id": CLAIMS}, INTRUDER, "read another student's resume"),
    ("resume-retest-generate", {"resume_claims_id": CLAIMS}, INTRUDER, "retest on another student's resume"),
    ("resume-question-generator", {"resume_claims_id": CLAIMS}, INTRUDER, "questions from another student's resume"),
    ("resume-coding-generate", {"resume_claims_id": CLAIMS}, INTRUDER, "coding round from another student's resume"),
    ("resume-parser", {"storage_path": f"{VICTIM}/resume.pdf"}, INTRUDER, "parse another student's resume file"),
    ("mock-interview-score", {"interview_id": NOBODY_UUID}, INTRUDER, "score an interview that is not theirs"),
    ("levels-warm", {"up_to_level": 1}, INTRUDER, "admin-only content warm-up"),
    ("company-lot", {"student_id": VICTIM, "title": "x", "brief": "y" * 60, "mode": "written"}, INTRUDER, "a student creating a company Lot"),
    ("company-lot", {"student_id": "3d99656a-950f-4bb8-ab75-e97317e68542", "title": "x", "brief": "y" * 60, "mode": "written"}, COMPANY, "a company targeting a student it has not shortlisted"),
    ("lot-writer", {"source_content_id": NOBODY_UUID}, COMPANY, "a company asking for a student Lot"),
    ("submit-sandbox-task", {"task_id": CODE_TASK, "code": "print(1)"}, COMPANY, "a company submitting a student's task"),
    ("scheduled-job?job=prune-events", {}, INTRUDER, "a signed-in user running a scheduled job"),
    ("transcription-reap", {}, INTRUDER, "a signed-in user running the recovery job"),
    ("create-student-users", {"students": []}, INTRUDER, "a student importing students"),
    ("create-college-user", {"email": "x@test.invalid"}, INTRUDER, "a student creating a college account"),
    ("send-onboarding-email", {"email": "x@test.invalid"}, INTRUDER, "a student sending platform email"),
]

usage_before = st.call("svc", "GET", "llm_usage?select=id&order=created_at.desc&limit=1")[1]
subs_before = st.call("svc", "GET", f"task_submissions?select=id&student_id=eq.{VICTIM}")[1]
voice_before = st.call("svc", "GET", f"voice_explanations?select=id&student_id=eq.{VICTIM}")[1]

results = []
for fn, body, who, why in CASES:
    code, out = st.call(who, "FN", fn, body)
    ok = code in (400, 401, 403, 404, 409, 422)
    results.append(ok)
    print(("PASS" if ok else "FAIL"), f"{fn:28s} {code}  {why}  ->  {json.dumps(out)[:90]}", flush=True)

# With no token at all, every function must answer 401 (security-log is the one public endpoint).
for fn in sorted({c[0].split("?")[0] for c in CASES} | {"app-guide-chat", "run-code", "level-open", "client-log", "interests-analyze"}):
    code, out = st.http(f"{st.FUNCTIONS}/{fn}", {}, {}, "POST")
    ok = code in (401, 403)
    results.append(ok)
    if not ok:
        print("FAIL", f"{fn:28s} {code}  no token  ->  {json.dumps(out)[:90]}")
print("no-token sweep done")

# The nine proof-era functions are deleted (Wave 8): nobody can reach them any more.
for fn in RETIRED:
    for who in (INTRUDER, "svc"):
        code, out = st.call(who, "FN", fn, {"proof_id": NOBODY_UUID})
        ok = code == 404
        results.append(ok)
        if not ok:
            print("FAIL", f"{fn:28s} {code}  retired function still answers  ->  {json.dumps(out)[:90]}")
print("retired-function sweep done")

usage_after = st.call("svc", "GET", "llm_usage?select=id&order=created_at.desc&limit=1")[1]
ok = usage_before == usage_after
results.append(ok); print("PASS" if ok else "FAIL", "no AI call was made by any refused request")
ok = subs_before == st.call("svc", "GET", f"task_submissions?select=id&student_id=eq.{VICTIM}")[1]
results.append(ok); print("PASS" if ok else "FAIL", "the victim's submissions are unchanged")
ok = voice_before == st.call("svc", "GET", f"voice_explanations?select=id&student_id=eq.{VICTIM}")[1]
results.append(ok); print("PASS" if ok else "FAIL", "the victim's recordings are unchanged")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
