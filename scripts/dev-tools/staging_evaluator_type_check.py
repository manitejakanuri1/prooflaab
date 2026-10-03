"""STAGING ONLY. Evaluator-type integrity (G2, migration 74): a task's declared grading type and
its evaluator must agree, for every existing task and for every way of creating one.

    python scripts/dev-tools/staging_evaluator_type_check.py
"""
import os, sys, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

S = "99999999-0001-0000-0000-000000000001"
SANDBOX = "452e588c-42b6-4f55-bf5c-b7090cad2a09"
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:150], flush=True)


def count(q):
    req = urllib.request.Request(f"{st.API}/tasks?select=id&{q}&limit=1",
                                 headers={"Authorization": f"Bearer {st.token('svc')}", "Prefer": "count=exact"})
    with urllib.request.urlopen(req) as r:
        return int(r.headers["Content-Range"].split("/")[1])


total = count("id=not.is.null")
check("every existing coding task has tests and no checklist", count("grading_type=eq.coding&or=(sandbox_config_id.is.null,rubric_config_id.not.is.null)") == 0, f"{count('grading_type=eq.coding')} coding of {total}")
check("every existing written task has a checklist and no tests", count("grading_type=eq.written&or=(rubric_config_id.is.null,sandbox_config_id.not.is.null)") == 0, f"{count('grading_type=eq.written')} written")
check("no task without a declared type", count("grading_type=is.null") == 0)

new = lambda body: st.call("svc", "POST", "tasks?select=id,grading_type,sandbox_config_id,rubric_config_id", {"student_id": S, "title": "evaluator-type check (synthetic)", **body})
made = []
c, b = new({"grading_type": "coding"})
check("declared coding with no tests is refused (never given the generic checklist)", c >= 400 and "needs its tests" in str(b), (c, b))
c, b = new({"grading_type": "coding", "rubric_config_id": st.call("svc", "GET", "task_rubric_config?select=id&is_generic_fallback=is.true&limit=1")[1][0]["id"]})
check("declared coding with only the generic checklist is refused", c >= 400, (c, str(b)[:90]))
c, b = new({"grading_type": "written", "sandbox_config_id": SANDBOX})
check("declared written graded by code tests is refused", c >= 400, (c, str(b)[:90]))
c, b = new({"grading_type": "coding", "sandbox_config_id": SANDBOX})
ok = c == 201 and b[0]["grading_type"] == "coding"; made += [r["id"] for r in b] if ok else []
check("declared coding with tests is accepted", ok, (c, str(b)[:90]))
c, b = new({})
ok = c == 201 and b[0]["grading_type"] == "written" and b[0]["rubric_config_id"]; made += [r["id"] for r in b] if c == 201 else []
check("undeclared task with no checker becomes written with a checklist", ok, (c, str(b)[:120]))
if made:
    c, b = st.call("svc", "PATCH", f"tasks?id=eq.{made[0]}", {"sandbox_config_id": None})
    check("an existing coding task cannot lose its tests", c >= 400, (c, str(b)[:90]))
for t in made:
    st.call("svc", "DELETE", f"tasks?id=eq.{t}&title=like.evaluator-type*")
c, b = st.call(f"user:{S}", "RPC", "sponsor_lot", {})
check("the old sponsor_lot path is gone", c == 404, c)

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
