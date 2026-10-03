"""STAGING ONLY. A suspended student's still-valid ticket must stop working (G1, migration 73).

A synthetic student gets a ticket, is suspended, and then uses the SAME ticket for every
protected action. All must be refused by the server. The student is then restored and the
same ticket must work again. Protected test fixtures are never suspended.

    python scripts/dev-tools/staging_suspended_check.py
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

VICTIM = "10ad0000-0000-4000-8000-000000000777"          # synthetic load-test student, not a fixture
WHO = f"user:{VICTIM}"
PROTECTED = "99999999-0001-0000-0000-000000000001"       # protected fixture
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:150], flush=True)


ticket = st.token(WHO, ttl=3000)                          # ONE ticket, issued before the suspension


def api(verb, path, body=None):
    return st.http(f"{st.API}/{'rpc/' if verb == 'RPC' else ''}{path}", body if verb != "GET" else None,
                   {"Authorization": f"Bearer {ticket}", "Prefer": "return=representation"},
                   "POST" if verb == "RPC" else verb)


def fn(name, body):
    return st.http(f"{st.FUNCTIONS}/{name}", body, {"Authorization": f"Bearer {ticket}"}, "POST")


_, tasks = st.call("svc", "GET", f"tasks?select=id&student_id=eq.{VICTIM}&order=lot_date.desc&limit=1")
TASK = tasks[0]["id"]

ACTIONS = [
    ("read today's Lot / tasks", lambda: api("GET", f"tasks?select=id&student_id=eq.{VICTIM}&limit=1")),
    ("read own profile", lambda: api("GET", f"student_profiles?select=id&id=eq.{VICTIM}")),
    ("change own profile", lambda: api("PATCH", f"student_profiles?id=eq.{VICTIM}", {"career_goals": "suspended-check"})),
    ("squad", lambda: api("RPC", "my_squad_members", {})),
    ("ask for today's Lot (lot-writer)", lambda: fn("lot-writer", {})),
    ("Run code", lambda: fn("run-code", {"language": "python", "code": "print(1)"})),
    ("Run a task's tests", lambda: fn("run-sandbox", {"task_id": TASK, "code": "print(1)"})),
    ("Submit written work", lambda: fn("submit-written-task", {"task_id": TASK, "answer": "x " * 60})),
    ("Submit code", lambda: fn("submit-sandbox-task", {"task_id": TASK, "code": "print(1)"})),
    ("create a recording (enqueue)", lambda: fn("transcription-enqueue", {"storage_path": f"{VICTIM}/s.webm", "task_id": TASK, "idempotency_key": f"susp-{time.time()}"})),
    ("create a recording (direct row)", lambda: api("POST", "voice_explanations", {"student_id": VICTIM, "task_id": TASK, "storage_path": f"{VICTIM}/s2.webm"})),
    ("help chat (AI)", lambda: fn("app-guide-chat", {"message": "hi", "history": []})),
]

# 0. Before: the ticket works (a refusal for another reason is fine; a suspension refusal is not).
c, b = api("GET", f"student_profiles?select=id,status&id=eq.{VICTIM}")
check("before suspension the ticket works", c == 200 and b and b[0]["status"] == "active", (c, b))
c, b = fn("run-code", {"language": "python", "code": "print(1)"})
check("before suspension Run works", c == 200, (c, str(b)[:80]))

# 1. Suspend (the server's own write), then wait out the functions service's 30 s memory.
ai_before = st.call("svc", "GET", "llm_usage?select=id&order=created_at.desc&limit=1")[1]
subs_before = st.call("svc", "GET", f"task_submissions?select=id&student_id=eq.{VICTIM}")[1]
c, _ = st.call("svc", "PATCH", f"student_profiles?id=eq.{VICTIM}", {"status": "suspended"})
check("student suspended", c == 200, c)
c, b = api("GET", f"tasks?select=id&student_id=eq.{VICTIM}&limit=1")
check("database API refuses at once", c == 403 and "suspended" in json.dumps(b), (c, b))
time.sleep(35)

# 2. Every protected action with the old, still-valid ticket.
for name, act in ACTIONS:
    c, b = act()
    check(f"suspended: {name} refused", c in (401, 403), (c, str(b)[:90]))
check("suspended: no AI call was made", ai_before == st.call("svc", "GET", "llm_usage?select=id&order=created_at.desc&limit=1")[1])
check("suspended: no submission was written", subs_before == st.call("svc", "GET", f"task_submissions?select=id&student_id=eq.{VICTIM}")[1])
check("suspended: profile unchanged", st.call("svc", "GET", f"student_profiles?select=career_goals&id=eq.{VICTIM}")[1][0]["career_goals"] != "suspended-check")

# 3. Other students are untouched, and a protected fixture cannot be suspended by the sync job.
c, b = st.call(f"user:{PROTECTED}", "GET", f"student_profiles?select=id&id=eq.{PROTECTED}")
check("another student is unaffected", c == 200 and len(b) == 1, c)
c, n = st.call("svc", "RPC", "sync_suspend_students", {"_ids": [PROTECTED]})
c2, b2 = st.call("svc", "GET", f"student_profiles?select=status&id=eq.{PROTECTED}")
check("a protected fixture is not suspended by the sync job", n == 0 and b2[0]["status"] == "active", (n, b2))

# 4. Restore: the same ticket works again.
c, _ = st.call("svc", "PATCH", f"student_profiles?id=eq.{VICTIM}", {"status": "active"})
c, b = api("GET", f"tasks?select=id&student_id=eq.{VICTIM}&limit=1")
check("restored: database API works at once", c == 200, (c, str(b)[:60]))
time.sleep(35)
c, b = fn("run-code", {"language": "python", "code": "print(1)"})
check("restored: Run works again with the same ticket", c == 200, (c, str(b)[:80]))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
