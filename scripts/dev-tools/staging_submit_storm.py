"""STAGING ONLY. Duplicate / idempotency storm for coding Submit (release freeze, 6 Oct 2026).

    python scripts/dev-tools/staging_submit_storm.py

Each case uses its own synthetic Load Student and a fresh coding task (xp_reward 10), then checks the
database, not the HTTP replies: exactly one passed submission, XP paid exactly once, task completed,
no submission bound to another student or task, and no later result overwriting an earlier one.
  two-tabs        2 correct Submits at the same moment
  double-click    6 correct Submits at the same moment
  race            1 correct + 1 wrong at the same moment
  late-wrong      correct, then a wrong Submit afterwards (refused: already completed)
  timeout-retry   client gives up after 0.3 s (server keeps going), then submits again
No AI is used. Results: e2e-out/final/submit-storm.json
"""
import json, os, sys, threading, time, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

GRADE = "3545a46b-a17f-4f2e-8788-35ada1b5e699"
ref = st.call("svc", "GET", f"task_sandbox_config?select=reference_solution&id=eq.{GRADE}")[1][0]["reference_solution"]
WRONG = "input()\nprint('A')"
run = time.strftime("%H%M%S")
out = []


def fresh(n):
    who = f"10ad0000-0000-4000-8000-{14950 + n:012d}"
    tid = f"10ad3003-{run[:4]}-4000-8000-{int(run) * 100 + n:012d}"
    c, b = st.call("svc", "POST", "tasks", {"id": tid, "student_id": who, "title": f"STORM {n}", "description": "storm",
                                            "category": "technical", "status": "pending", "source": "lot", "lot_category": "technical",
                                            "difficulty": "Easy", "sandbox_config_id": GRADE, "xp_reward": 10})
    assert c == 201, (c, b)
    xp0 = st.call("svc", "GET", f"student_profiles?select=total_xp&id=eq.{who}")[1][0]["total_xp"] or 0
    return who, tid, xp0


def submit(who, tid, code, res, i):
    res[i] = st.call(f"user:{who}", "FN", "submit-sandbox-task", {"task_id": tid, "code": code})[0]


def together(who, tid, codes):
    res = [None] * len(codes)
    ts = [threading.Thread(target=submit, args=(who, tid, c, res, i)) for i, c in enumerate(codes)]
    for t in ts: t.start()
    for t in ts: t.join()
    return res


def facts(who, tid, xp0):
    subs = st.call("svc", "GET", f"task_submissions?select=id,student_id,task_id,status,xp_awarded,created_at&task_id=eq.{tid}&order=created_at")[1]
    xp = st.call("svc", "GET", f"xp_logs?select=id&student_id=eq.{who}&source=eq.task:{tid}")[1]
    total = st.call("svc", "GET", f"student_profiles?select=total_xp&id=eq.{who}")[1][0]["total_xp"] or 0
    task = st.call("svc", "GET", f"tasks?select=status&id=eq.{tid}")[1][0]["status"]
    return {"submissions": len(subs), "passed": sum(s["status"] == "passed" for s in subs),
            "statuses": [s["status"] for s in subs], "xp_rows": len(xp), "xp_gain": total - xp0, "task": task,
            "wrong_owner": sum(s["student_id"] != who or s["task_id"] != tid for s in subs)}


def case(name, n, fn, expect):
    who, tid, xp0 = fresh(n)
    codes = fn(who, tid)
    time.sleep(3)
    f = facts(who, tid, xp0)
    ok = all(f[k] == v for k, v in expect.items()) and f["wrong_owner"] == 0
    out.append({"case": name, "http": codes, **f, "expect": expect, "ok": ok})
    print(f"{'PASS' if ok else 'FAIL'} {name:14} http={codes} {f}", flush=True)


def timeout_retry(who, tid):
    req = urllib.request.Request(f"{st.FUNCTIONS}/submit-sandbox-task", method="POST",
                                 data=json.dumps({"task_id": tid, "code": ref}).encode(),
                                 headers={"Authorization": f"Bearer {st.token('user:' + who)}", "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=0.3)
        first = "answered"
    except Exception as e:
        first = type(e).__name__
    time.sleep(8)  # let the abandoned request finish on the server before retrying
    time.sleep(1)
    return [first, st.call(f"user:{who}", "FN", "submit-sandbox-task", {"task_id": tid, "code": ref})[0]]


case("two-tabs", 0, lambda w, t: together(w, t, [ref, ref]), {"passed": 1, "xp_rows": 1, "xp_gain": 10, "task": "completed"})
case("double-click", 1, lambda w, t: together(w, t, [ref] * 6), {"passed": 1, "xp_rows": 1, "xp_gain": 10, "task": "completed"})
case("race", 2, lambda w, t: together(w, t, [ref, WRONG]), {"passed": 1, "xp_rows": 1, "xp_gain": 10, "task": "completed"})
case("late-wrong", 3, lambda w, t: [st.call(f"user:{w}", "FN", "submit-sandbox-task", {"task_id": t, "code": c})[0] for c in (ref, WRONG)],
     {"submissions": 1, "passed": 1, "xp_rows": 1, "xp_gain": 10, "task": "completed"})
case("timeout-retry", 4, timeout_retry, {"passed": 1, "xp_rows": 1, "xp_gain": 10, "task": "completed"})

os.makedirs(os.path.join(os.path.dirname(__file__), "..", "..", "e2e-out", "final"), exist_ok=True)
json.dump(out, open(os.path.join(os.path.dirname(__file__), "..", "..", "e2e-out", "final", "submit-storm.json"), "w"), indent=1)
print(f"\n{sum(r['ok'] for r in out)}/{len(out)} storm cases clean")
sys.exit(0 if out and all(r["ok"] for r in out) else 1)
