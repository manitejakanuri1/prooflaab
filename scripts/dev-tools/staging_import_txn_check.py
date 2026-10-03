"""STAGING ONLY. Proves migration 62 (F19): a student import record is all-or-nothing and
safe to repeat. Works on a synthetic DATABASE account only (record_account) - no Identity
Platform login is created, because staging shares production's login pool.

    python scripts/dev-tools/staging_import_txn_check.py
"""
import os, sys, uuid
sys.path.insert(0, os.path.dirname(__file__))
import st  # noqa: E402

COLLEGE = "99999999-0000-0000-0000-000000000002"
run = uuid.uuid4().hex[:8]
email = f"f19.{run}@test.invalid"
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS" if ok else "FAIL"), name, "-", str(detail)[:160], flush=True)


def rows(uid):
    role = st.call("svc", "GET", f"user_roles?select=role&user_id=eq.{uid}")[1]
    prof = st.call("svc", "GET", f"student_profiles?select=id,full_name,college_id,onboarding_status&user_id=eq.{uid}")[1]
    contact = st.call("svc", "GET", f"student_contact?select=email,phone&student_id=eq.{prof[0]['id']}")[1] if prof else []
    return role, prof, contact


c, uid = st.call("svc", "RPC", "record_account", {"_provider_uid": f"f19-{run}", "_email": email, "_full_name": "F19 Probe", "_vouched": True})
check("synthetic database account created (no login anywhere)", c == 200 and isinstance(uid, str), (c, uid))
args = {"_user_id": uid, "_email": email, "_full_name": "F19 Probe", "_branch": "CSE", "_phone": "9000000000"}

# 1. Failure in the middle: an unknown college. Nothing may be left behind.
c, b = st.call("svc", "RPC", "import_student_record", {**args, "_college_id": str(uuid.uuid4())})
role, prof, contact = rows(uid)
check("a failing import writes nothing: no role, no profile, no contact", c >= 400 and role == [] and prof == [], (c, b, role, prof))

# 1b. Failure AFTER the first write (the role is inserted, then the profile step fails):
#     the role must be rolled back with it.
c, b = st.call("svc", "RPC", "import_student_record", {**args, "_college_id": COLLEGE, "_existing_profile_id": str(uuid.uuid4())})
role, prof, contact = rows(uid)
check("a failure after the role was written rolls the role back too", c >= 400 and "no longer exists" in str(b) and role == [] and prof == [], (c, b, role, prof))

# 2. A browser cannot call it at all.
c, b = st.call("user:99999999-0000-0000-0000-000000000001", "RPC", "import_student_record", {**args, "_college_id": COLLEGE})
check("a signed-in college account cannot call it directly", c in (401, 403, 404), (c, b))

# 3. Success writes all three.
c, pid = st.call("svc", "RPC", "import_student_record", {**args, "_college_id": COLLEGE})
role, prof, contact = rows(uid)
check("a good import writes role + profile + contact together",
      c == 200 and role == [{"role": "student"}] and len(prof) == 1 and prof[0]["college_id"] == COLLEGE
      and contact == [{"email": email, "phone": "9000000000"}], (c, role, prof, contact))

# 4. Running it again converges: same profile, no duplicate, phone kept when not supplied.
c, pid2 = st.call("svc", "RPC", "import_student_record", {**{k: v for k, v in args.items() if k != "_phone"}, "_college_id": COLLEGE, "_full_name": "F19 Probe Renamed"})
role, prof, contact = rows(uid)
check("re-running the import updates the same record, no duplicates",
      c == 200 and pid2 == pid and len(prof) == 1 and prof[0]["full_name"] == "F19 Probe Renamed" and len(role) == 1
      and contact[0]["phone"] == "9000000000", (c, pid2 == pid, prof, contact))

# 5. An account that already has another role is never turned into a student.
c, b = st.call("svc", "RPC", "import_student_record", {**args, "_user_id": "99999999-0000-0000-0000-000000000001", "_college_id": COLLEGE})
check("a college account is not converted into a student", c >= 400 and "already has the role" in str(b), (c, b))

# Clean up the synthetic account (cascades to role, profile, contact).
c, b = st.call("svc", "DELETE", f"student_profiles?id=eq.{pid}&full_name=like.F19*")
role, prof, _ = rows(uid)
print("cleanup:", c, str(b)[:80], "| remaining profile rows:", len(prof))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
