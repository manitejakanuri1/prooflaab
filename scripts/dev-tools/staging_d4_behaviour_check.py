"""STAGING ONLY. D3/D4 behaviour gate (5 Oct 2026): who can really call which database function.

    python scripts/dev-tools/staging_d4_behaviour_check.py

Uses synthetic staging accounts only (Load Students 14607 college 7 / 14608 college 8, LOADTEST
colleges 7 and 8, the staging admin, the staging test recruiters). Inputs are real, valid-shaped ids,
so a refusal is proof (not a PGRST202 "no such function").
1. Anonymous sweep: every function the API exposes is called as an anonymous visitor with real ids.
   Each must be refused, or answer nothing (empty / null / false / {"error": ...}). The few that are
   public by design (pure helpers, global default settings) are listed in PUBLIC_OK.
2. Admin-only functions: refused to a student and a college; work for the admin.
3. Cross-student / cross-college / recruiter / company tests on the functions that take an id.
4. Self-approval (migration 84) through the API: a student cannot create a verified recruiter, an
   approved company or college; a pending recruiter cannot verify itself. Written rows are removed.
5. Nothing changed for Student B (task, submission, voice, notifications, role).
"""
import json, os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
M = json.load(open(os.path.join(ROOT, "scripts", "rpc_manifest.json"), encoding="utf-8"))
A, B, PEER = (f"10ad0000-0000-4000-8000-{n:012d}" for n in (14607, 14608, 14617))
TPO7, TPO8 = "10adc011-0000-4000-8000-000000000007", "10adc011-0000-4000-8000-000000000008"
C7, C8 = "10adc011-0000-4000-9000-000000000007", "10adc011-0000-4000-9000-000000000008"
ADMIN = "ffed80fc-08ee-4cce-ac54-9432ef2d81f9"
REC_OK = "b19ab84b-2ebe-4dc8-8a51-470b2193168e"      # verified staging test company
REC_PENDING = "fc46a028-f3bf-4355-a7c9-2d68148ba4e8"  # unverified staging test recruiter
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:500], flush=True)


g = lambda p: st.call("svc", "GET", p)[1]
S8 = g(f"seasons?select=id&college_id=eq.{C8}&is_current=eq.true&limit=1")[0]["id"]
SQ8 = g(f"squads?select=id&college_id=eq.{C8}&limit=1")[0]["id"]
TB = g(f"tasks?select=id&student_id=eq.{B}&order=created_at&limit=1")[0]["id"]
SUBB = (g(f"task_submissions?select=id&student_id=eq.{B}&limit=1") or [{"id": str(uuid.uuid4())}])[0]["id"]
VB = (g(f"voice_explanations?select=id&student_id=eq.{B}&limit=1") or [{"id": str(uuid.uuid4())}])[0]["id"]
SL = (g("recruiter_shortlists?select=id&limit=1") or [{"id": str(uuid.uuid4())}])[0]["id"]
RUN = (g("bug_finder_runs?select=run_id&limit=1") or [{"run_id": str(uuid.uuid4())}])[0]["run_id"]
CONTENT = (g("source_content?select=id&limit=1") or [{"id": str(uuid.uuid4())}])[0]["id"]


def state():
    return (g(f"tasks?select=status,started_at,xp_reward&id=eq.{TB}"), g(f"task_submissions?select=status&id=eq.{SUBB}"),
            g(f"voice_explanations?select=withdrawn_at&id=eq.{VB}"), len(g(f"notifications?select=id&user_id=eq.{B}")),
            g(f"user_roles?select=role&user_id=eq.{B}"), g(f"student_profiles?select=total_xp,status,college_id,cohort&id=eq.{B}"),
            len(g(f"squad_members?select=id&student_id=eq.{B}&left_at=is.null")), len(g("recruiter_shortlists?select=id")),
            len(g(f"interventions?select=id&student_id=eq.{B}")), len(g("squads?select=id")),
            g(f"recruiter_shortlists?select=student_response,responded_at,stage&id=eq.{SL}"),
            g(f"squads?select=name,max_members&id=eq.{SQ8}"))


before = state()

# ---- 1. anonymous sweep over every function the API exposes -------------------------------------
spec = st.http(f"{st.API}/", None, {"Authorization": f"Bearer {st.token('svc')}"}, "GET")[1]
VALUES = {"student": B, "user": B, "college": C8, "season": S8, "squad": SQ8, "task": TB, "submission": SUBB,
          "shortlist": SL, "run": RUN, "recruiter": REC_OK, "interview": str(uuid.uuid4())}


def arg(name, prop):
    t, n = prop.get("type"), name.lower()
    if prop.get("format") == "uuid" or "uuid" in str(prop.get("format", "")):
        if n in ("_id",):
            return VB if "voice" in fn else CONTENT
        return next((v for k, v in VALUES.items() if k in n), str(uuid.uuid4()))
    if prop.get("format") == "date":
        return "2026-10-05"
    if t == "integer":
        return 1
    if t == "boolean":
        return False
    if t == "number":
        return 0.5
    if t == "array":
        return []
    if t in ("object",) or "json" in str(prop.get("format", "")):
        return {}
    return "x"


def body_of(path):
    post = spec["paths"][path].get("post") or {}
    for p in post.get("parameters", []):
        if p.get("in") == "body":
            props = p.get("schema", {}).get("properties", {})
            return {k: arg(k, v) for k, v in props.items()}
    return {}


def kind(c, b):
    """REFUSED: an error, or an answer that says no. EMPTY: nothing about anybody. DATA: anything else."""
    if c in (401, 403) or (c >= 400 and isinstance(b, dict) and b.get("code") in ("42501", "P0001", "PT403", "22023", "28000")):
        return "REFUSED"
    if c >= 400:
        return f"ERROR {c} {b.get('code') if isinstance(b, dict) else ''}"
    if isinstance(b, dict) and ("error" in b or b.get("ok") is False):
        return "REFUSED"
    falsy = lambda x: x in (None, "", [], {}, False, 0)
    if falsy(b) or (isinstance(b, dict) and all(falsy(v) for v in b.values())) or (isinstance(b, list) and all(falsy(x) for x in b)):
        return "EMPTY"
    return "DATA"


def fill(fn, given):
    return {**body_of(f"/rpc/{fn}"), **given}


EXT = {sig.split("(")[0].replace("public.", "") for sig in M["extension_pure"]}   # pgcrypto / pg_trgm: pure, no table access
PUBLIC_OK = EXT | {"check_answer", "template_key",                                 # pure helpers, no data
             "my_suggested_tracks",                                               # anonymous: the public track catalogue
             "tpo_naming_themes", "tpo_scoring_rules",                            # global default settings (no college)
             "student_is_discoverable"}                                          # yes/no about a public profile
# helpers that only answer about the caller (anonymous gets nothing back about anybody)
rpcs = sorted(p for p in spec["paths"] if p.startswith("/rpc/"))
data, odd = [], []
for path in rpcs:
    fn = path[5:]
    c, b = st.http(f"{st.API}{path}", body_of(path), {}, "POST")
    k = kind(c, b)
    if fn in EXT:
        continue
    if k == "DATA" and fn not in PUBLIC_OK:
        data.append(f"{fn}: {json.dumps(b)[:80]}")
    elif k.startswith("ERROR"):
        odd.append(f"{fn}: {k} {(b or {}).get('message', '')[:60] if isinstance(b, dict) else ''}")
check(f"anonymous sweep: {len(rpcs)} exposed functions refuse or return nothing to an anonymous visitor (real ids)", not data, data)
check("anonymous sweep: no unexpected server errors", not odd, odd)

# ---- 2. admin-only functions --------------------------------------------------------------------
ADMIN_CALLS = {"admin_bug_finder_runs": {"_limit": 1}, "admin_bug_finder_steps": {"_run_id": RUN}, "admin_content_library": {},
               "admin_content_page": {"_id": CONTENT}, "admin_recruiters": {}, "admin_trace_errors": {"_days": 1},
               "admin_trace_funnels": {"_days": 1}, "admin_trace_search": {"_q": ""}, "admin_trace_slow": {"_days": 1},
               "admin_trace_student": {"_student_id": B, "_hours": 1, "_limit": 1},
               "admin_hide_content": {"_id": str(uuid.uuid4()), "_hidden": False},
               "admin_verify_recruiter": {"_recruiter_id": str(uuid.uuid4()), "_verified": False},
               "admin_notify_student": {"_student_id": B, "_title": "D4 probe", "_message": "x", "_type": "system", "_link": None}}
bad = []
for fn, args in ADMIN_CALLS.items():
    for who in (A, TPO7, REC_OK):
        if fn == "admin_notify_student" and who == TPO7:
            continue                                   # TPO 7 is not B's college: tested in section 3
        c, b = st.call(f"user:{who}", "RPC", fn, args)
        if kind(c, b) == "DATA" or c in (200, 204) and fn in ("admin_notify_student",):
            bad.append(f"{fn} as {who[-5:]}: {c} {json.dumps(b)[:60]}")
check(f"admin-only functions refused to a student, a college and a company ({len(ADMIN_CALLS)} functions)", not bad, bad)
ok = [fn for fn in ("admin_bug_finder_runs", "admin_content_library", "admin_recruiters", "admin_trace_search", "admin_trace_errors")
      if st.call(f"user:{ADMIN}", "RPC", fn, ADMIN_CALLS[fn])[0] == 200]
check("admin-only functions work for the admin", len(ok) == 5, ok)

# ---- 3. cross-student / cross-college / recruiter / company -------------------------------------
def r(who, fn, args):
    c, b = st.call(f"user:{who}", "RPC", fn, args) if who else st.http(f"{st.API}/rpc/{fn}", args, {}, "POST")
    return kind(c, b)


CASES = [  # (caller, function, args, expected): True = answered (not refused), False = refused or nothing,
           #                                       None = a write that must change nothing (proved in section 5)
    (A, "tpo_student_profile", {"_student_id": B}, False), (TPO7, "tpo_student_profile", {"_student_id": B}, False),
    (TPO8, "tpo_student_profile", {"_student_id": B}, True), (ADMIN, "tpo_student_profile", {"_student_id": B}, True),
    (A, "tpo_student_learning", {"_student_id": B}, False), (TPO7, "tpo_student_learning", {"_student_id": B}, False),
    (TPO8, "tpo_student_learning", {"_student_id": B}, True),
    (A, "topic_priorities", {"_student_id": B, "_limit": 1}, False), (TPO7, "topic_priorities", {"_student_id": B, "_limit": 1}, False),
    (TPO8, "topic_priorities", {"_student_id": B, "_limit": 1}, True),
    (A, "season_leaderboard", {"_kind": "students", "_season_id": S8, "_limit": 5}, False),
    (TPO7, "season_leaderboard", {"_kind": "students", "_season_id": S8, "_limit": 5}, False),
    (TPO8, "season_leaderboard", {"_kind": "students", "_season_id": S8, "_limit": 5}, True),
    (A, "season_awards", {"_season_id": S8}, False), (TPO7, "season_awards", {"_season_id": S8}, False),
    (A, "can_see_season", {"_season_id": S8}, False), (B, "can_see_season", {"_season_id": S8}, True),
    (A, "sandbox_task_view", {"_task_id": TB}, False), (A, "rubric_task_view", {"_task_id": TB}, False),
    (B, "rubric_task_view", {"_task_id": TB}, True),
    (A, "portfolio_work", {"_student_id": B}, False),
    (A, "recruiter_proof_profile", {"_student_id": B}, False), (REC_PENDING, "recruiter_proof_profile", {"_student_id": B}, False),
    (A, "recruiter_talent", {}, False), (REC_PENDING, "recruiter_talent", {}, False), (A, "recruiter_home", {}, False),
    (A, "company_submissions", {}, False), (TPO7, "company_submissions", {}, False), (REC_PENDING, "company_submissions", {}, False),
    (A, "tpo_students", {}, False), (TPO7, "tpo_students", {}, True), (TPO7, "tpo_attention", {}, True),
    (A, "needs_review_submissions", {}, False), (TPO7, "needs_review_submissions", {}, True),
    (A, "admin_notify_student", {"_student_id": B, "_title": "D4", "_message": "x"}, None),
    (TPO7, "admin_notify_student", {"_student_id": B, "_title": "D4", "_message": "x"}, None),
    (TPO7, "tpo_send_reminder", {"_student_id": B, "_reason": "x", "_message": "x"}, None),
    (TPO7, "assign_to_squad", {"_student_id": B, "_squad_id": SQ8}, None),
    (TPO7, "tpo_squad_update", {"_squad_id": SQ8, "_name": "D4"}, None),
    (TPO7, "tpo_set_cohorts", {"_assignments": [{"student_id": B, "cohort": "D4"}]}, None),
    (A, "start_task_assignment", {"_task_id": TB}, None), (A, "withdraw_voice_explanation", {"_id": VB}, None),
    (A, "review_task_submission", {"_submission_id": SUBB, "_approve": False}, None),
    (TPO7, "review_task_submission", {"_submission_id": SUBB, "_approve": False}, None),
    (A, "respond_to_shortlist", {"_shortlist_id": SL, "_accept": False}, None), (None, "respond_to_shortlist", {"_shortlist_id": SL, "_accept": False}, None),
    (REC_PENDING, "recruiter_shortlist", {"_student_id": B, "_note": "D4"}, None),
    (REC_PENDING, "record_outcome", {"_student_id": B, "_outcome": "hired"}, None),
    (A, "company_review_submission", {"_submission_id": SUBB, "_decision": "approved", "_note": "x"}, None),
    (A, "tpo_run_week", {"_week": 1}, None), (A, "tpo_create_squad", {"_name": "D4"}, None),
]
bad = []
for who, fn, given, expected in CASES:
    k = r(who, fn, fill(fn, given))
    if k.startswith("ERROR") or (expected is True and k == "REFUSED") or (expected is False and k == "DATA"):
        bad.append(f"{fn} as {(who or 'anonymous')[-5:]}: got {k}, expected {'an answer' if expected else 'refused/empty'}")
check(f"cross-student / cross-college / recruiter / company: {len(CASES)} calls behave as designed", not bad, bad)
seen = {x["student_id"] for x in st.call(f"user:{TPO7}", "RPC", "needs_review_submissions", {})[1]}
foreign = [s for s in seen if g(f"student_profiles?select=college_id&id=eq.{s}")[0]["college_id"] != C7]
check("college 7's review list holds only college-7 students", not foreign, foreign[:5])

# ---- 4. self-approval through the API (migration 84) --------------------------------------------
made = []
c1, _ = st.call(f"user:{A}", "POST", "recruiters", {"id": A, "company": "D4 probe", "contact_name": "D4", "work_email": "d4@example.invalid", "verified": True})
made.append(("recruiters", f"id=eq.{A}"))
v1 = st.call(f"user:{A}", "RPC", "is_verified_recruiter", {})[1]
c2, _ = st.call(f"user:{A}", "POST", "startups", {"user_id": A, "name": "D4 probe", "email": "d4@example.invalid", "verification_status": "approved", "status": "active"})
made.append(("startups", f"user_id=eq.{A}"))
v2 = st.call(f"user:{A}", "RPC", "my_company_ok", {})[1]
c3, _ = st.call(f"user:{A}", "POST", "colleges", {"user_id": A, "name": "D4 probe", "email": "d4@example.invalid", "verification_status": "approved", "status": "active"})
made.append(("colleges", f"user_id=eq.{A}"))
v3 = st.call(f"user:{A}", "RPC", "my_college_id", {})[1]
c4, _ = st.call(f"user:{REC_PENDING}", "PATCH", f"recruiters?id=eq.{REC_PENDING}", {"verified": True})
v4 = g(f"recruiters?select=verified&id=eq.{REC_PENDING}")
removed = [st.call("svc", "DELETE", f"{t}?{q}")[0] for t, q in made]
check("a student cannot create a verified recruiter / approved company / approved college; a pending recruiter cannot verify itself",
      v1 is False and v2 is False and v3 in (None, "") and v4 == [{"verified": False}],
      {"recruiter": (c1, v1), "company": (c2, v2), "college": (c3, v3), "self-verify": (c4, v4), "cleanup": removed})
left = [len(g(f"{t}?select=*&{q}")) for t, q in made]
check("self-approval probe rows removed", left == [0, 0, 0], left)

# ---- 4b. D3: admin_users -------------------------------------------------------------------------
admins_before = len(g("user_roles?select=id&role=eq.admin"))
rid = g("user_roles?select=id&role=eq.admin&limit=1")[0]["id"]
emailB = g(f"student_contact?select=email&student_id=eq.{B}")[0]["email"]
got = {}
for label, who in (("anonymous", None), ("student", A), ("college", TPO7), ("company", REC_OK)):
    h = {} if who is None else {"Authorization": f"Bearer {st.token('user:' + who)}"}
    got[label] = (kind(*st.http(f"{st.API}/admin_users?select=id,email", None, h, "GET")),
                  kind(*st.http(f"{st.API}/admin_users", {"email": emailB, "role": "admin"}, h, "POST")),
                  kind(*st.http(f"{st.API}/admin_users?id=eq.{rid}", {"status": "inactive"}, {**h, "Prefer": "return=representation"}, "PATCH")),
                  st.http(f"{st.API}/admin_users?id=eq.{rid}", None, h, "DELETE")[0])
admin_sees = kind(*st.call(f"user:{ADMIN}", "GET", "admin_users?select=id,email"))
check("D3 admin_users: anonymous / student / college / company read nothing and cannot add, remove or delete an admin; the admin can read",
      all(v[0] != "DATA" and v[1] == "REFUSED" and v[2] != "DATA" and v[3] >= 400 for v in got.values()) and admin_sees == "DATA"
      and len(g("user_roles?select=id&role=eq.admin")) == admins_before and g(f"user_roles?select=role&user_id=eq.{B}") == [{"role": "student"}],
      {"callers": got, "admin": admin_sees})

# ---- 4c. migration 86: system-owned credits; review_task_submission tells strangers nothing ------
credits_before = g("student_credits?select=student_id,credits_available,premium_status&order=student_id")
c1, _ = st.call(f"user:{A}", "POST", "student_credits", {"student_id": A, "credits_available": 99999, "credits_used_today": 0, "premium_status": True})
own_after_attack = g(f"student_credits?select=id&student_id=eq.{A}")
cs, _ = st.call("svc", "POST", "student_credits", {"student_id": A, "credits_available": 5, "credits_used_today": 0, "premium_status": False})
cu, _ = st.call("svc", "PATCH", f"student_credits?student_id=eq.{A}", {"credits_available": 6})
svc_row = g(f"student_credits?select=credits_available&student_id=eq.{A}")
own_read = st.call(f"user:{A}", "GET", f"student_credits?select=credits_available&student_id=eq.{A}")[1]
c3, _ = st.call(f"user:{A}", "PATCH", f"student_credits?student_id=eq.{A}", {"credits_available": 99999, "premium_status": True})
after_student_patch = g(f"student_credits?select=credits_available,premium_status&student_id=eq.{A}")
st.call("svc", "DELETE", f"student_credits?student_id=eq.{A}")
credits_after = g("student_credits?select=student_id,credits_available,premium_status&order=student_id")
check("credits: a student cannot create or raise their own credits/premium; the backend can; the student can read their row; test row removed",
      c1 in (401, 403) and not own_after_attack and cs in (200, 201) and cu in (200, 204) and svc_row == [{"credits_available": 6}]
      and own_read == [{"credits_available": 6}] and c3 in (401, 403)
      and after_student_patch == [{"credits_available": 6, "premium_status": False}] and credits_after == credits_before,
      {"student insert": c1, "row after attack": own_after_attack, "backend insert/update": (cs, cu, svc_row), "student read": own_read,
       "student patch": c3, "after student patch": after_student_patch, "table unchanged": credits_after == credits_before})

NR_STUDENT = "10ad0000-0000-4000-8000-000000000027"   # Load Student 27, college 7, has a submission awaiting review
NR = (g(f"task_submissions?select=id&status=eq.needs_review&student_id=eq.{NR_STUDENT}&limit=1") or [None])[0]
SUBS = ",".join([SUBB] + ([NR["id"]] if NR else []))


def review_state():
    return (g(f"task_submissions?select=id,status,xp_awarded&id=in.({SUBS})&order=id"),
            g(f"student_profiles?select=id,total_xp&id=in.({B},{NR_STUDENT})&order=id"),
            g(f"tasks?select=status&id=eq.{TB}"), len(g(f"xp_logs?select=id&student_id=in.({B},{NR_STUDENT})")),
            len(g(f"student_activity_events?select=id&student_id=eq.{NR_STUDENT}")))


def reason(who, sid):
    body = {"_submission_id": sid, "_approve": False}
    c, b = st.call(f"user:{who}", "RPC", "review_task_submission", body) if who else st.http(f"{st.API}/rpc/review_task_submission", body, {}, "POST")
    if isinstance(b, dict) and "reason" in b:
        return b["reason"]
    return f"{c}:{b.get('code') if isinstance(b, dict) else b}"


rs_before = review_state()
R = str(uuid.uuid4())
want = [  # (label, caller, submission, exact answer)
    ("anonymous", None, SUBB, "401:42501"), ("student A", A, SUBB, "forbidden"), ("college 7 (wrong)", TPO7, SUBB, "forbidden"),
    ("company", REC_OK, SUBB, "forbidden"), ("student A, random id", A, R, "forbidden"), ("college 7, random id", TPO7, R, "forbidden"),
    ("college 8 (owner)", TPO8, SUBB, "not awaiting review"), ("admin", ADMIN, SUBB, "not awaiting review"),
    ("admin, random id", ADMIN, R, "no such submission")]
if NR:   # rejection path is only reached by an authorized caller; every caller here is unauthorized
    want += [("student A -> awaiting review", A, NR["id"], "forbidden"), ("college 8 (wrong) -> awaiting review", TPO8, NR["id"], "forbidden"),
             ("Student B -> awaiting review", B, NR["id"], "forbidden")]
got = {label: reason(who, sid) for label, who, sid, _ in want}
bad = {label: (got[label], exp) for label, _, _, exp in want if got[label] != exp}
check(f"review_task_submission: unauthorized callers always get 'forbidden' (no state or existence oracle); owner and admin get the real answer ({len(want)} bodies compared)",
      not bad and review_state() == rs_before, bad or got)

# ---- 5. nothing changed for Student B ------------------------------------------------------------
after = state()
check("nothing changed for Student B (task, submission, voice, notifications, role, profile, squad, shortlists, reminders, squads)",
      before == after, {"before": before, "after": after} if before != after else "")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
