"""STAGING ONLY. The same stored score everywhere (release audit, step 10).

    python scripts/dev-tools/staging_score_consistency.py [stage]

For students of a finished load stage: the database row (service), what the student's own
session reads (Build-log queries), portfolio_work (Profile), the college's view
(tpo_student_profile, as that college's TPO), the company view (recruiter_proof_profile) and the
admin's read. Every task score, rubric breakdown, voice score and content match must be equal.
"""
import json, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

ADMIN = "ffed80fc-08ee-4cce-ac54-9432ef2d81f9"
COMPANY = "b19ab84b-2ebe-4dc8-8a51-470b2193168e"
stage = int(sys.argv[1]) if len(sys.argv) > 1 else 1
plan = json.load(open(os.path.join("e2e-out", "load2k", f"s{stage}-plan.json")))
random.seed(stage)
sample = random.sample(plan, min(25, len(plan)))
diffs, checked, seen = [], 0, {}


def sid(n):
    return f"10ad0000-0000-4000-8000-{n:012d}"


def flat(x):
    return json.dumps(x, default=str)


for p in sample:
    s = sid(p["n"])
    db = st.call("svc", "GET", f"task_submissions?select=id,status,sandbox_score,rubric_scores&task_id=eq.{p['task']}&order=created_at.desc")[1]
    vo = st.call("svc", "GET", f"voice_explanations?select=id,communication_score,evaluation&task_id=eq.{p['task']}&current_authoritative=is.true&status=eq.scored")[1]
    if not db:
        continue
    checked += 1
    sub, v = db[0], (vo[0] if vo else None)
    mine = st.call(f"user:{s}", "GET", f"task_submissions?select=id,status,sandbox_score,rubric_scores&task_id=eq.{p['task']}&order=created_at.desc")[1]
    myv = st.call(f"user:{s}", "GET", f"voice_explanations?select=id,communication_score,evaluation&task_id=eq.{p['task']}&current_authoritative=is.true&status=eq.scored")[1]
    if flat(mine[0]) != flat(sub):
        diffs.append((p["n"], "student Build-log submission", sub, mine[0]))
    if v and (not myv or myv[0]["communication_score"] != v["communication_score"]
              or (myv[0]["evaluation"] or {}).get("content_match") != (v["evaluation"] or {}).get("content_match")):
        diffs.append((p["n"], "student Build-log voice", v, myv))
    adm = st.call(f"user:{ADMIN}", "GET", f"task_submissions?select=id,status,sandbox_score,rubric_scores&task_id=eq.{p['task']}&order=created_at.desc")[1]
    if not adm or flat(adm[0]) != flat(sub):
        diffs.append((p["n"], "admin read", sub, adm[:1]))
    pw = st.call(f"user:{s}", "RPC", "portfolio_work", {"_student_id": s})[1]
    row = next((r for r in (pw or []) if flat(r).find(p["task"]) >= 0), None) if isinstance(pw, list) else None
    if row is not None:
        vals = list(row.values())
        if sub["sandbox_score"] not in vals or (v and v["communication_score"] not in vals):
            diffs.append((p["n"], "Profile portfolio_work", (sub["sandbox_score"], v and v["communication_score"]), row))
    college = st.call("svc", "GET", f"student_profiles?select=college_id&id=eq.{s}")[1][0]["college_id"]
    tpo_user = college.replace("-4000-9000-", "-4000-8000-")
    tp = st.call(f"user:{tpo_user}", "RPC", "tpo_student_profile", {"_student_id": s})
    text = flat(tp[1])
    if tp[0] != 200 or (sub["status"] == "passed" and f'"ai_score": {sub["sandbox_score"]}' not in text and f'"ai_score":{sub["sandbox_score"]}' not in text):
        diffs.append((p["n"], "TPO tpo_student_profile", sub["sandbox_score"], (tp[0], text[:200])))
    seen.setdefault("tpo_http", set()).add(tp[0])
    cp = st.call(f"user:{COMPANY}", "RPC", "recruiter_proof_profile", {"_student_id": s})
    seen.setdefault("company_http", set()).add(cp[0])
    ctext = flat(cp[1])
    if cp[0] == 200 and "No candidate found" in ctext:
        seen.setdefault("company_not_visible", set()).add(p["n"]); continue
    if cp[0] == 200 and sub["status"] == "passed" and f'"ai_score": {sub["sandbox_score"]}' not in ctext:
        diffs.append((p["n"], "company recruiter_proof_profile", sub["sandbox_score"], ctext[:200]))
    if cp[0] == 200 and v and f'"communication_score": {v["communication_score"]}' not in ctext:
        diffs.append((p["n"], "company voice", v["communication_score"], ctext[:200]))

print(json.dumps({"stage": stage, "students_checked": checked, "differences": len(diffs),
                  "views_http": {k: sorted(map(str, x)) for k, x in seen.items()}}, indent=1))
for d in diffs[:15]:
    print("DIFF", json.dumps(d, default=str)[:400])
