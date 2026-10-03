"""STAGING ONLY. Proves migration 61: a recording is bound to a submission, retries keep
history with exactly one authoritative record, and evidence cannot be changed or deleted.
Uses the protected staging fixture 'student_established'. Leaves its rows marked by the
storage_path prefix '<student>/voicecheck-' (synthetic; no audio is uploaded).

    python scripts/dev-tools/staging_voice_binding_check.py
"""
import json, subprocess, sys, time, uuid

S = "99999999-0001-0000-0000-000000000001"
TASK_DONE = "e4e25563-6072-42a7-8c8a-79efce3bb649"      # has submissions
TASK_NEW = "b1f20882-34ff-4701-adab-60cc6c1444e5"       # no submission yet
OTHER = "3d99656a-950f-4bb8-ab75-e97317e68542"          # a student at another college


sys.path.insert(0, __import__("os").path.dirname(__file__))
import st as _st  # noqa: E402


def st(who, verb, path, body=None):
    # Direct call, not the command line: the CLI prints at most 4,000 characters, which
    # truncates the list once a fixture has many recordings.
    return _st.call(who, verb, path, body)


results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:160])


run = uuid.uuid4().hex[:8]
path = lambda n: f"{S}/voicecheck-{run}-{n}.webm"
PREFER = "voice_explanations?select=id,submission_id,attempt_no,current_authoritative,transcript_source"

code, latest = st("svc", "GET", f"task_submissions?select=id&student_id=eq.{S}&task_id=eq.{TASK_DONE}&order=created_at.desc&limit=1")
latest_sub = latest[0]["id"]

# 1. No submission yet -> refused, for the student and for the server.
c, b = st(f"user:{S}", "POST", PREFER, {"student_id": S, "task_id": TASK_NEW, "storage_path": path("a")})
check("student cannot record before submitting", c >= 400 and "Submit your work first" in json.dumps(b), (c, b))
c, b = st("svc", "POST", PREFER, {"student_id": S, "task_id": TASK_NEW, "storage_path": path("b"),
                                   "transcript_source": "server", "transcription_status": "pending"})
check("server cannot create a recording with no submission", c >= 400 and "Submit your work first" in json.dumps(b), (c, b))

# 2. Browser-path recording: bound to the latest submission, never authoritative.
c, b = st(f"user:{S}", "POST", PREFER, {"student_id": S, "task_id": TASK_DONE, "storage_path": path("c"),
                                         "submission_id": None, "current_authoritative": True, "attempt_no": 99})
row = b[0] if isinstance(b, list) and b else {}
check("browser recording bound to the latest submission", row.get("submission_id") == latest_sub, row)
check("browser recording is not authoritative; attempt number is the server's",
      row.get("current_authoritative") is False and row.get("attempt_no") != 99, row)
first_attempt = row.get("attempt_no", 0)

# 3. Someone else's submission -> refused.
c, b = st(f"user:{OTHER}", "POST", PREFER, {"student_id": OTHER, "submission_id": latest_sub, "storage_path": f"{OTHER}/x-{run}.webm"})
check("another student cannot bind to this submission", c >= 400, (c, b))

# 4. Two server recordings: history kept, exactly one authoritative.
ids = []
for n in ("d", "e"):
    c, b = st("svc", "POST", PREFER, {"student_id": S, "task_id": TASK_DONE, "storage_path": path(n),
                                       "transcript_source": "server", "transcription_status": "pending",
                                       "transcription_idempotency_key": f"voicecheck-{run}-{n}"})
    ids.append(b[0])
check("retries get increasing attempt numbers",
      ids[0]["attempt_no"] == first_attempt + 1 and ids[1]["attempt_no"] == first_attempt + 2, [i["attempt_no"] for i in ids])
c, rows = st("svc", "GET", f"voice_explanations?select=id,attempt_no,current_authoritative&submission_id=eq.{latest_sub}&order=attempt_no")
auth = [r for r in rows if r["current_authoritative"]]
check("exactly one authoritative recording per submission, the newest",
      len(auth) == 1 and auth[0]["id"] == ids[1]["id"] and len(rows) >= 3, f"{len(rows)} rows, authoritative={[a['attempt_no'] for a in auth]}")

# 5. Evidence cannot be moved, re-pointed or rewritten - even by the server.
vid = ids[1]["id"]
c, b = st("svc", "PATCH", f"voice_explanations?id=eq.{vid}", {"storage_path": path("swapped")})
check("audio path cannot be swapped", c >= 400, (c, b))
c, b = st("svc", "PATCH", f"voice_explanations?id=eq.{vid}", {"submission_id": None})
check("recording cannot be unbound from its submission", c >= 400, (c, b))
st("svc", "PATCH", f"voice_explanations?id=eq.{vid}", {"transcript": "I looped over the log lines and counted failures per user in a dictionary.",
                                                       "transcription_status": "completed"})
c, b = st("svc", "PATCH", f"voice_explanations?id=eq.{vid}", {"transcript": "a different story"})
check("finished transcript cannot be rewritten", c >= 400, (c, b))

# 6. A student cannot delete evidence, only withdraw it.
c, b = st(f"user:{S}", "DELETE", f"voice_explanations?id=eq.{vid}")
c2, still = st("svc", "GET", f"voice_explanations?select=id&id=eq.{vid}")
check("student delete removes nothing", len(still) == 1, (c, b))
c, b = st(f"user:{OTHER}", "RPC", "withdraw_voice_explanation", {"_id": vid})
check("another student cannot withdraw it", c >= 400, (c, b))
c, b = st(f"user:{S}", "RPC", "withdraw_voice_explanation", {"_id": vid})
c2, after = st("svc", "GET", f"voice_explanations?select=withdrawn_at,current_authoritative,transcript&id=eq.{vid}")
a = after[0]
check("owner withdrawal keeps the row, erases the transcript, clears authoritative",
      b is True and a["withdrawn_at"] and a["transcript"] is None and a["current_authoritative"] is False, a)
c, b = st("svc", "PATCH", f"voice_explanations?id=eq.{vid}", {"current_authoritative": True})
check("withdrawn recording cannot become authoritative again", c >= 400, (c, b))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
