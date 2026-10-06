"""STAGING ONLY. Does the coding evaluator tell right from wrong? (release audit, steps 7-8)

    python scripts/dev-tools/staging_coding_audit.py

For three real generated Python problems, twelve kinds of solution are SUBMITTED through the
real path (submit-sandbox-task -> code runner -> record_task_submission) by a synthetic audit
student (Load Student 14999), one fresh task each. The expected verdict is written down first.
Then Run vs Submit: hidden tests never leave the server (Run, Submit, errors, table reads),
a student cannot write or change a grade, cannot submit for another student's task.
No AI is used. Results: e2e-out/coding-audit.json
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

S = "10ad0000-0000-4000-8000-000000014999"
OTHER_TASK_OWNER = "10ad0000-0000-4000-8000-000000014998"
WHO = f"user:{S}"

SUM = "d8759dbd-39e9-4cec-b629-87081b95a2ff"     # sum of the even numbers in a list
FAILS = "452e588c-42b6-4f55-bf5c-b7090cad2a09"   # failed logins per user, sorted
GRADE = "3545a46b-a17f-4f2e-8788-35ada1b5e699"   # mark -> letter grade

ENV_PROBE = "import os\nprint(sorted(k for k in os.environ))\nprint(open('/etc/hostname').read() if os.path.exists('/etc/hostname') else 'no hostname')"
NET_PROBE = "import socket\ntry:\n    socket.create_connection(('8.8.8.8', 53), timeout=3); print('NETWORK OPEN')\nexcept Exception as e:\n    print('blocked', type(e).__name__)"
LOOP = "while True:\n    pass"
MEMORY = "a = bytearray(6 * 1024 ** 3)\nprint(len(a))"

READ_N = "import sys\nd = sys.stdin.read().split()\nn = int(d[0]) if d else 0\nnums = list(map(int, d[1:1 + n]))\n"
SOLUTIONS = {
    SUM: {
        "1 canonical (reference)": None,
        "2 different correct algorithm": READ_N + "print(sum(filter(lambda x: x % 2 == 0, nums)))",
        "3 brute force, correct": READ_N + "t = 0\nfor i in range(len(nums)):\n    for j in range(len(nums)):\n        if i == j and nums[i] & 1 == 0:\n            t += nums[j]\nprint(t)",
        "4 obviously wrong (sum of all)": READ_N + "print(sum(nums))",
        "5 hard-coded sample answer": "print(6)",
        "6 off-by-one (drops last number)": READ_N + "print(sum(x for x in nums[:-1] if x % 2 == 0))",
        "7 passes samples, fails negatives": READ_N + "print(sum(x for x in nums if x > 0 and x % 2 == 0))",
        "8 inefficient but correct": READ_N + "t = 0\nfor x in nums:\n    for _ in range(1000):\n        pass\n    if x % 2 == 0:\n        t += x\nprint(t)",
        "9 formatting variation (trailing spaces)": READ_N + "print(str(sum(x for x in nums if x % 2 == 0)) + '   ')",
        "10 unsafe: network": NET_PROBE,
        "11 infinite loop": LOOP,
        "12 excessive memory": MEMORY,
    },
    FAILS: {
        "1 canonical (reference)": None,
        "2 different correct algorithm": "import sys\nfrom collections import Counter\nd = sys.stdin.read().split()\nn = int(d[0]) if d else 0\nc = Counter(d[1 + 2 * i] for i in range(n) if d[2 + 2 * i] == 'FAIL')\nfor u in sorted(c):\n    print(u, c[u])",
        "3 brute force, correct": "import sys\nd = sys.stdin.read().split()\nn = int(d[0]) if d else 0\nrows = [(d[1 + 2 * i], d[2 + 2 * i]) for i in range(n)]\nfor u in sorted(set(r[0] for r in rows)):\n    k = len([r for r in rows if r[0] == u and r[1] == 'FAIL'])\n    if k:\n        print(u, k)",
        "4 obviously wrong (counts every line)": "import sys\nd = sys.stdin.read().split()\nn = int(d[0]) if d else 0\nc = {}\nfor i in range(n):\n    c[d[1 + 2 * i]] = c.get(d[1 + 2 * i], 0) + 1\nfor u in sorted(c):\n    print(u, c[u])",
        "5 hard-coded sample answer": "print('alice 1')\nprint('bob 1')",
        "6 off-by-one (skips last line)": "import sys\nd = sys.stdin.read().split()\nn = int(d[0]) if d else 0\nc = {}\nfor i in range(n - 1):\n    if d[2 + 2 * i] == 'FAIL':\n        c[d[1 + 2 * i]] = c.get(d[1 + 2 * i], 0) + 1\nfor u in sorted(c):\n    print(u, c[u])",
        "7 passes samples, fails edge (all OK -> prints a message)": "import sys\nd = sys.stdin.read().split()\nn = int(d[0]) if d else 0\nc = {}\nfor i in range(n):\n    if d[2 + 2 * i] == 'FAIL':\n        c[d[1 + 2 * i]] = c.get(d[1 + 2 * i], 0) + 1\nif n and not c:\n    print('no failures')\nfor u in sorted(c):\n    print(u, c[u])",
        "8 inefficient but correct": "import sys\nd = sys.stdin.read().split()\nn = int(d[0]) if d else 0\nout = []\nfor i in range(n):\n    u = d[1 + 2 * i]\n    if u in [x[0] for x in out]:\n        continue\n    k = sum(1 for j in range(n) if d[1 + 2 * j] == u and d[2 + 2 * j] == 'FAIL')\n    if k:\n        out.append((u, k))\nfor u, k in sorted(out):\n    print(u, k)",
        "9 formatting variation (unsorted output)": "import sys\nd = sys.stdin.read().split()\nn = int(d[0]) if d else 0\nc = {}\nfor i in range(n):\n    if d[2 + 2 * i] == 'FAIL':\n        c[d[1 + 2 * i]] = c.get(d[1 + 2 * i], 0) + 1\nfor u in c:\n    print(u, c[u])",
        "10 unsafe: read the runner's environment": ENV_PROBE,
        "11 infinite loop": LOOP,
        "12 excessive memory": MEMORY,
    },
    GRADE: {
        "1 canonical (reference)": None,
        "2 different correct algorithm": "m = int(input())\nprint('FFFFFFDCBAA'[m // 10])",
        "3 brute force, correct": "m = int(input())\nfor lo, g in ((90, 'A'), (80, 'B'), (70, 'C'), (60, 'D'), (0, 'F')):\n    if any(m == v for v in range(lo, 101)):\n        print(g)\n        break",
        "4 obviously wrong (always A)": "input()\nprint('A')",
        "5 hard-coded sample answer": "print('B')",
        "6 off-by-one (> instead of >=)": "m = int(input())\nprint('A' if m > 90 else 'B' if m > 80 else 'C' if m > 70 else 'D' if m > 60 else 'F')",
        "7 passes samples, fails 59 (>= 59 is D)": "m = int(input())\nprint('A' if m >= 90 else 'B' if m >= 80 else 'C' if m >= 70 else 'D' if m >= 59 else 'F')",
        "8 inefficient but correct": "m = int(input())\ng = 'F'\nfor _ in range(200000):\n    g = 'A' if m >= 90 else 'B' if m >= 80 else 'C' if m >= 70 else 'D' if m >= 60 else 'F'\nprint(g)",
        "9 formatting variation (lower case)": "m = int(input())\nprint(('A' if m >= 90 else 'B' if m >= 80 else 'C' if m >= 70 else 'D' if m >= 60 else 'F').lower())",
        "10 unsafe: network": NET_PROBE,
        "11 infinite loop": LOOP,
        "12 excessive memory": MEMORY,
    },
}
# Release-freeze additions (6 Oct 2026): failure and abuse cases, on the first problem only.
FORK = "import os\nfor _ in range(400):\n    try:\n        os.fork()\n    except OSError:\n        break\nprint(6)"
METADATA = ("import urllib.request\ntry:\n    r = urllib.request.Request('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token',"
            " headers={'Metadata-Flavor': 'Google'})\n    print(urllib.request.urlopen(r, timeout=3).read()[:40])\nexcept Exception as e:\n    print('blocked', type(e).__name__)")
COMMAND = ("import subprocess\nr = subprocess.run(['sh', '-c', 'id; ls /app; cat /proc/1/environ | head -c 300'], capture_output=True, text=True)\n"
           "print(r.stdout.replace(chr(0), ' '), r.stderr[:100])")
DBCONN = ("import socket\nfor host in ('35.234.220.224', '8.234.86.229', '10.0.0.3'):\n    try:\n        socket.create_connection((host, 5432), timeout=3)\n"
          "        print('DB REACHABLE', host)\n    except Exception as e:\n        print('blocked', host, type(e).__name__)\n"
          "import os\nprint('cloudsql dir', os.path.exists('/cloudsql'))")
SOLUTIONS[SUM].update({
    "13 empty code": "   ",
    "14 syntax error (does not compile)": READ_N + "print(sum(nums)",
    "15 runtime error": READ_N + "print(nums[10 ** 6])",
    "16 fork / process abuse": FORK,
    "17 metadata-server attempt": METADATA,
    "18 command execution attempt": COMMAND,
    "19 database connection attempt": DBCONN,
})
ESCAPE_MARKS = ("NETWORK OPEN", "DB REACHABLE", "ya29.", "RUNNER_SECRET", "SERVICE_ROLE", "uid=0", "cloudsql dir True")

# What a correct evaluator must say, written before running.
EXPECT = {"1": "passed", "2": "passed", "3": "passed", "4": "failed", "5": "failed", "6": "failed", "7": "failed",
          "8": "passed", "10": "failed", "11": "failed", "12": "failed",
          "13": "http 400", "14": "failed", "15": "failed", "16": "failed", "17": "failed", "18": "failed", "19": "failed"}
EXPECT_9 = {SUM: "passed", FAILS: "failed", GRADE: "failed"}   # whitespace is forgiven; order and case are answers

cfgs = {c["id"]: c for c in st.call("svc", "GET", f"task_sandbox_config?select=id,test_cases,reference_solution,pass_threshold&id=in.({SUM},{FAILS},{GRADE})")[1]}
hidden_strings = {cid: [t["expected_output"].strip() for t in c["test_cases"] if not t["visible"] and len(t["expected_output"].strip()) > 3]
                  + [t["stdin"].strip() for t in c["test_cases"] if not t["visible"] and len(t["stdin"].strip()) > 3] for cid, c in cfgs.items()}
run = time.strftime("%H%M%S")
rows, leaks = [], []


_next = [14900]


def student():
    """One synthetic student per submission: Submit is limited to 20 per student per hour."""
    _next[0] += 1
    return f"10ad0000-0000-4000-8000-{_next[0]:012d}"


def task_for(cid, label, owner=S):
    tid_n = abs(hash((cid, label, run))) % 10**12
    tid = f"10ad3000-{run[:4]}-4000-8000-{tid_n:012d}"
    c, b = st.call("svc", "POST", "tasks", {"id": tid, "student_id": owner, "title": f"AUDIT code {label}", "description": "coding audit",
                                            "category": "technical", "status": "pending", "source": "lot", "lot_category": "technical",
                                            "difficulty": "Easy", "sandbox_config_id": cid})
    assert c == 201, (c, b)
    return tid


def leaked(cid, text):
    return [h for h in hidden_strings[cid] if h and h in text]


for cid, sols in SOLUTIONS.items():
    for label, code in sols.items():
        code = code or cfgs[cid]["reference_solution"]
        k = label.split()[0]
        expect = EXPECT_9[cid] if k == "9" else EXPECT[k]
        who = student()
        tid = task_for(cid, label, who)
        t0 = time.time()
        c, b = st.call(f"user:{who}", "FN", "submit-sandbox-task", {"task_id": tid, "code": code})
        text = json.dumps(b)
        status = ("passed" if b.get("passed") else "failed") if c == 200 and isinstance(b, dict) else f"http {c}"
        verdicts = [r.get("verdict") for r in (b.get("results") or [])] if isinstance(b, dict) else []
        rows.append({"problem": cid[:8], "solution": label, "student": who, "task": tid, "expected": expect, "actual": status, "score": b.get("score") if isinstance(b, dict) else None,
                     "threshold": cfgs[cid]["pass_threshold"], "verdicts": verdicts, "ok": status == expect, "seconds": round(time.time() - t0, 1),
                     # migration 91: "passed" means verified correct - every test accepted, whatever the score
                     "verified_rule_ok": status != "passed" or (bool(verdicts) and all(v == "accepted" for v in verdicts)),
                     "visible_output": [r.get("actual", "")[:300] for r in (b.get("results") or []) if r.get("visible")]
                                       if k in ("10", "16", "17", "18", "19") else None})
        rows[-1]["escape"] = any(m in " ".join(rows[-1]["visible_output"] or []) for m in ESCAPE_MARKS)
        rows[-1]["ok"] = rows[-1]["ok"] and rows[-1]["verified_rule_ok"] and not rows[-1]["escape"]
        if leaked(cid, text):
            leaks.append(("submit", label, leaked(cid, text)))
        print(f"{'OK  ' if rows[-1]['ok'] else 'BAD '} {cid[:8]} {label:52} expected={expect:7} actual={status:7} score={rows[-1]['score']} {verdicts}", flush=True)

# ---- Run vs Submit -------------------------------------------------------------------
checks = []
def check(name, ok, detail=""):
    checks.append({"check": name, "ok": bool(ok), "detail": str(detail)[:200]})
    print(("PASS " if ok else "FAIL ") + name + " - " + str(detail)[:160], flush=True)

S = student(); WHO = f"user:{S}"
tid = task_for(GRADE, "run-vs-submit", S)
c, b = st.call(WHO, "FN", "run-sandbox", {"task_id": tid, "code": cfgs[GRADE]["reference_solution"]})
check("Run grades only the visible tests", c == 200 and all(r["visible"] for r in b["results"]) and len(b["results"]) == sum(t["visible"] for t in cfgs[GRADE]["test_cases"]), [r["id"] for r in b.get("results", [])])
check("Run leaves no submission and does not complete the task",
      st.call("svc", "GET", f"task_submissions?select=id&task_id=eq.{tid}")[1] == [] and st.call("svc", "GET", f"tasks?select=status&id=eq.{tid}")[1][0]["status"] != "completed")
c, b = st.call(WHO, "FN", "run-sandbox", {"task_id": tid, "code": "raise SystemExit(1/0)"})
check("a Run that crashes shows no hidden input or expected output", not leaked(GRADE, json.dumps(b)), c)
c, b = st.call(WHO, "FN", "submit-sandbox-task", {"task_id": tid, "code": "print(input()+'?')"})
check("Submit answers hidden tests with verdicts only (no input, expected or actual)",
      all(set(r) <= {"id", "visible", "verdict", "passed"} for r in b["results"] if not r["visible"]) and not leaked(GRADE, json.dumps(b)), b.get("results", [])[-1:])
_, rowsub = st.call(WHO, "GET", f"task_submissions?select=details&task_id=eq.{tid}")
check("the stored submission the student can read has no hidden test data", rowsub and not leaked(GRADE, json.dumps(rowsub)), len(rowsub or []))
c, b = st.call(WHO, "GET", f"task_sandbox_config?select=test_cases,reference_solution&id=eq.{GRADE}")
check("student cannot read the test set or reference solution", c != 200 or b == [] or all(not r.get("test_cases") for r in b), (c, str(b)[:80]))
c, b = st.call(WHO, "RPC", "sandbox_task_view", {"_task_id": tid})
check("the task screen's data has no hidden test", not leaked(GRADE, json.dumps(b)), c)
c, b = st.call(WHO, "POST", "task_submissions", {"task_id": tid, "student_id": S, "status": "passed", "sandbox_score": 100, "code": "x"})
check("student cannot write a graded submission directly", c in (401, 403), c)
sub = st.call("svc", "GET", f"task_submissions?select=id,status&task_id=eq.{tid}")[1][0]
c, b = st.call(WHO, "PATCH", f"task_submissions?id=eq.{sub['id']}", {"status": "passed", "sandbox_score": 100})
after = st.call("svc", "GET", f"task_submissions?select=status,sandbox_score&id=eq.{sub['id']}")[1][0]
check("student cannot change their own grade", after["status"] == sub["status"] and after["status"] != "passed", (c, after))
other = st.call("svc", "POST", "tasks", {"student_id": OTHER_TASK_OWNER, "title": "AUDIT other student's task", "description": "x", "category": "technical",
                                          "status": "pending", "source": "lot", "lot_category": "technical", "difficulty": "Easy", "sandbox_config_id": GRADE})[1][0]["id"]
c, b = st.call(WHO, "FN", "submit-sandbox-task", {"task_id": other, "code": cfgs[GRADE]["reference_solution"]})
check("student cannot submit for another student's task", c == 404 and st.call("svc", "GET", f"task_submissions?select=id&task_id=eq.{other}")[1] == [], c)
c, b = st.call(WHO, "FN", "run-sandbox", {"task_id": other, "code": "print(1)"})
check("student cannot Run against another student's task", c == 404, c)
c, b = st.call(WHO, "FN", "run-sandbox", {"config_id": GRADE, "use_reference": True})
check("student cannot use the admin reference check", c == 403, c)

json.dump({"run": run, "solutions": rows, "leaks": leaks, "run_vs_submit": checks},
          open(os.path.join(os.path.dirname(__file__), "..", "..", "e2e-out", "coding-audit.json"), "w"), indent=1)
bad = [r for r in rows if not r["ok"]]
print(f"\nsolutions: {len(rows) - len(bad)}/{len(rows)} as expected; hidden-test leaks: {len(leaks)}; run-vs-submit: "
      f"{sum(c['ok'] for c in checks)}/{len(checks)} checks passed")
sys.exit(0 if rows and not bad and not leaks and checks and all(c["ok"] for c in checks) else 1)
