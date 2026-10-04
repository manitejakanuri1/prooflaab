"""STAGING ONLY. Database-function authorization gate (D1, 4 Oct 2026).

    python scripts/dev-tools/staging_rpc_authz_check.py

1. Reads, on staging, who may EXECUTE every public function (exact signatures).
   FAIL if a function in scripts/rpc_manifest.json `server_only` is executable by PUBLIC, anon or
   authenticated, or if service_role lost EXECUTE on it.
   FAIL if ANY function executable by anon/authenticated is missing from the manifest (a new
   exposure fails even when the total count stays the same).
2. Through the real API: every server-only function, called as anonymous and as a student, must be
   refused (401/403, permission denied) - the request is rejected before the function body runs.
3. Forged grade: a student calls record_task_submission for their own task with score 100 /
   passed. Must be refused, and nothing may change (submissions, task status, XP).
No AI, no load. Prints FUNCTION / ACTUAL / EXPECTED for every failure.
"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
M = json.load(open(os.path.join(ROOT, "scripts", "rpc_manifest.json"), encoding="utf-8"))
results = []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:400], flush=True)


# ---- 1. privileges on staging, by signature ------------------------------------------------
sql = os.path.join(ROOT, "e2e-out", "rpc-authz.sql")
os.makedirs(os.path.dirname(sql), exist_ok=True)
open(sql, "w", encoding="utf-8", newline="\n").write("\n".join([
    r"\pset pager off", r"\pset format unaligned", r"\pset fieldsep |",
    "select 'FN', p.oid::regprocedure, has_function_privilege('anon',p.oid,'execute'), "
    "has_function_privilege('authenticated',p.oid,'execute'), has_function_privilege('service_role',p.oid,'execute'), "
    "coalesce((select bool_or(a.grantee=0) from aclexplode(p.proacl) a), true), p.prorettype::regtype, "
    "(p.prosrc ~* 'is_admin\(\)|has_role\(') "
    "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';"]) + "\n")
r = subprocess.run(["bash", "scripts/dev-tools/staging_sql.sh", "e2e-out/rpc-authz.sql"], capture_output=True, text=True, cwd=ROOT)
ex = r.stdout.strip().split("(")[-1].rstrip(")")
log = subprocess.run(f'gcloud logging read "resource.type=cloud_run_job AND labels.\\"run.googleapis.com/execution_name\\"={ex}" '
                     f'--project=prooflab-508214 --freshness=30m --format="value(textPayload)" --order=asc',
                     shell=True, capture_output=True, text=True).stdout
acl = {}
for line in log.splitlines():
    if line.startswith("FN|"):
        _, sig, anon, auth, svc, pub, rt, guard = line.split("|")
        acl[sig] = {"anon": anon == "t", "authenticated": auth == "t", "service_role": svc == "t", "PUBLIC": pub == "t",
                    "trigger": rt == "trigger", "admin_guard": guard == "t"}
check("read function privileges on staging", len(acl) > 200, f"{len(acl)} functions")

bad = []
for sig in M["server_only"]:
    a = acl.get(sig)
    if a is None:
        bad.append((sig, "missing", "exists"))
    elif a["PUBLIC"] or a["anon"] or a["authenticated"] or not a["service_role"]:
        bad.append((sig, {k: a[k] for k in ("PUBLIC", "anon", "authenticated", "service_role")}, "PUBLIC/anon/authenticated false, service_role true"))
check(f"server-only functions refuse PUBLIC/anon/authenticated ({len(M['server_only'])} signatures)", not bad,
      "; ".join(f"FUNCTION {s} ACTUAL {a} EXPECTED {e}" for s, a, e in bad))
bad = []
for sig in M["sql_internal"]:
    a = acl.get(sig)
    if a is None or a["PUBLIC"] or a["anon"] or a["authenticated"] or not a["service_role"]:
        bad.append((sig, a and {k: a[k] for k in ("PUBLIC", "anon", "authenticated", "service_role")}, "PUBLIC/anon/authenticated false, service_role true"))
check(f"SQL-internal functions are not directly callable ({len(M['sql_internal'])} signatures)", not bad,
      "; ".join(f"FUNCTION {s} ACTUAL {a} EXPECTED {e}" for s, a, e in bad))
bad = [s for s in M["admin_only"] if s in acl and (acl[s]["anon"] or acl[s]["authenticated"]) and not acl[s]["admin_guard"]]
check(f"every directly callable admin function checks is_admin()/has_role() ({len(M['admin_only'])} signatures)", not bad,
      "; ".join(f"FUNCTION {s} ACTUAL callable without is_admin()/has_role() in its body EXPECTED an admin guard" for s in bad))
bad = [s for s in M["policy_helper"] if s in acl and not acl[s]["authenticated"]]
check("policy helpers still executable by signed-in users (RLS needs them)", not bad, "; ".join(f"FUNCTION {s} lost authenticated EXECUTE" for s in bad))
known = set(M["server_only"]) | set(M["sql_internal"]) | set(M["user_callable"]) | set(M["admin_only"]) | set(M["policy_helper"]) | set(M["pending_review"])
new = sorted(s for s, a in acl.items() if not a["trigger"] and (a["anon"] or a["authenticated"]) and s not in known)
check("no function outside the manifest is executable by anon/authenticated", not new,
      "; ".join(f"FUNCTION {s} ACTUAL {acl[s]} EXPECTED listed in scripts/rpc_manifest.json with a caller class" for s in new))

# ---- 2. through the API --------------------------------------------------------------------
S = "10ad0000-0000-4000-8000-000000014602"
student = {"Authorization": f"Bearer {st.token('user:' + S)}"}
leaks = []
for sig in M["server_only"]:
    name = sig.split("(")[0]
    for who, h in (("anonymous", {}), ("student", student)):
        c, b = st.http(f"{st.API}/rpc/{name}", {}, h, "POST")
        code = (b or {}).get("code") if isinstance(b, dict) else None
        # 42501 = permission denied; PGRST202 = no function matches these (empty) arguments for this
        # role - PostgREST only finds functions the role may execute, so both mean "refused".
        if not (c in (401, 403, 404) and code in ("42501", "PGRST202")):
            leaks.append(f"{name} as {who}: {c} {str(b)[:80]}")
check(f"API refuses every server-only function to anonymous and student callers ({2 * len(M['server_only'])} calls)", not leaks, "; ".join(leaks))

import uuid as _uuid
R = str(_uuid.uuid4())
NOOP = {"advance_season": {"_season_id": R}, "close_season": {"_season_id": R}, "run_squad_week": {"_season_id": R, "_week": 1},
        "settle_round": {"_season_id": R, "_round": 1}, "create_lot_for": {"_student_id": R, "_for_date": "2000-01-01"},
        "seed_lot_template": {"_source_content_id": R}, "claim_lot_template": {"_source_content_id": R}, "has_role": {"_user_id": R, "_role": "admin"},
        "plan_student_week": {"_student_id": R, "_week_start": "2000-01-03"}, "suggest_tracks": {"_student_id": R, "_limit": 1},
        "score_student_week": {"_student_id": R, "_season_id": R, "_week": 1}, "next_lot_source": {"_student_id": R}}
reached = []
for name, args in NOOP.items():
    for who, h in (("anonymous", {}), ("student", student)):
        c, b = st.http(f"{st.API}/rpc/{name}", args, h, "POST")
        code = b.get("code") if isinstance(b, dict) else None
        if not ((c in (401, 403) and code == "42501") or code == "PGRST202"):
            reached.append(f"{name} as {who}: {c} {code}")
check(f"API refuses SQL-internal functions with a no-op input ({2 * len(NOOP)} calls, random ids)", not reached, "; ".join(reached))

# ---- 3. forged grade -------------------------------------------------------------------------
G = "3545a46b-a17f-4f2e-8788-35ada1b5e699"
c, t = st.call("svc", "POST", "tasks", {"student_id": S, "title": "AUDIT D1 forge probe", "description": "x", "category": "technical",
                                        "status": "pending", "source": "lot", "lot_category": "technical", "difficulty": "Easy", "sandbox_config_id": G})
tid = t[0]["id"]
before = (st.call("svc", "GET", f"task_submissions?select=id&task_id=eq.{tid}")[1], st.call("svc", "GET", f"tasks?select=status,completed_at&id=eq.{tid}")[1],
          st.call("svc", "GET", f"student_profiles?select=total_xp&id=eq.{S}")[1])
forged = {"_student_id": S, "_task_id": tid, "_sandbox_config_id": G, "_language": "python", "_code": "print('A')",
          "_passed_count": 6, "_total_count": 6, "_score": 100, "_details": [], "_runner": "prooflab", "_duration_ms": 1,
          "_rubric_config_id": None, "_rubric_scores": None, "_flags": []}
c, b = st.http(f"{st.API}/rpc/record_task_submission", forged, student, "POST")
check("student's forged record_task_submission (score 100) is refused", c in (401, 403) and isinstance(b, dict) and b.get("code") == "42501", (c, b))
c2, b2 = st.http(f"{st.API}/rpc/record_task_submission", forged, {}, "POST")
check("anonymous forged record_task_submission is refused", c2 in (401, 403) and isinstance(b2, dict) and b2.get("code") == "42501", (c2, b2))
after = (st.call("svc", "GET", f"task_submissions?select=id&task_id=eq.{tid}")[1], st.call("svc", "GET", f"tasks?select=status,completed_at&id=eq.{tid}")[1],
         st.call("svc", "GET", f"student_profiles?select=total_xp&id=eq.{S}")[1])
check("nothing changed: no submission, task not completed, XP unchanged", before == after and after[0] == [] and after[1][0]["status"] == "pending", (before, after))
st.call("svc", "DELETE", f"tasks?id=eq.{tid}")      # the probe task only

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
