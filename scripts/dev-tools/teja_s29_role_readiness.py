"""S29: can each of the five staging test roles sign in for real? READ-ONLY.

It follows the path a real sign-in takes and stops at the first thing that would refuse it:

  1. Google Identity Platform   a login with this address, enabled, with a password
  2. auth-bridge                Identity id -> database id (migration 05):
                                  a uuid-shaped id IS the database id;
                                  any other id needs a row in account_identities;
                                  with no row, the first sign-in makes a NEW empty account.
  3. web_login_identity         (migration 102) role, organisation, suspension
  4. the dashboard              the role must be the one the journey expects

Usage:
  python teja_s29_role_readiness.py                     Identity only; database = NOT CHECKED
  python teja_s29_role_readiness.py --read-staging-db   also reads the STAGING database (GET only)

Safety:
  * Identity: only accounts:lookup (a query), for the five fixture addresses and ids.
  * Database: staging only, GET only, fixed tables and columns (see DB_READS). It uses the
    staging test-tooling credential that st.py already mints; the credential is never printed.
  * Nothing is created, changed, reset or deleted. Passwords are never read: for
    E2E_<ROLE>_PASSWORD only "set / not set" is reported.
  * Output holds roles and reason codes only. No address, no Identity id, no token.

Exit code: 0 only when all five roles are READY.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT = "prooflab-508214"
LOOKUP_URL = f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}/accounts:lookup"
STAGING_API = "https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app"
TIMEOUT = 30
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

READY, BLOCKED = "READY", "BLOCKED"
STAGING_FAKE_COLLEGE = "99999999-0000-0000-0000-000000000002"

# docs/STAGING-TEST-FIXTURES.md. The addresses are synthetic (.invalid can never receive mail).
ROLES = {
    "ADMIN": {"id": "ffed80fc-08ee-4cce-ac54-9432ef2d81f9", "role": "admin",
              "email": "e2e.admin@staging.prooflab.invalid"},
    "TPO": {"id": "99999999-0000-0000-0000-000000000001", "role": "college_admin",
            "email": "college@staging.prooflab.invalid", "org": STAGING_FAKE_COLLEGE},
    "COMPANY": {"id": "b19ab84b-2ebe-4dc8-8a51-470b2193168e", "role": "startup",
                "email": "probe.company@test.invalid"},
    "STUDENT": {"id": "b3786001-a791-449a-bcd3-115f222a8bf1", "role": "student",
                "email": "e2e.student@staging.prooflab.invalid", "org": STAGING_FAKE_COLLEGE},
    "ESTABLISHED": {"id": "99999999-0001-0000-0000-000000000001", "role": "student",
                    "email": "student1@staging.prooflab.invalid"},
}

REASONS = {
    "OK": "a real sign-in should reach the dashboard",
    "IDENTITY_MISSING": "no Identity login exists for this role",
    "IDENTITY_AMBIGUOUS": "more than one Identity login answered; never guess",
    "IDENTITY_DISABLED": "the Identity login is disabled",
    "IDENTITY_NO_PASSWORD": "the Identity login has no password",
    "UID_MISMATCH": "the login resolves to a different database account than the fixture",
    "DB_MAPPING_MISSING": "Identity id is not a uuid and account_identities has no row: "
                          "the first sign-in would create a new, empty account",
    "DB_NOT_CHECKED": "the staging database was not read, so the mapping is unknown",
    "ACCOUNT_NOT_PROVISIONED": "the database account has no role row",
    "WRONG_ROLE": "the database role is not the one this journey needs",
    "PROFILE_MISSING": "the role's own row (student / college / company) is missing",
    "SUSPENDED": "the account is suspended, blocked or rejected",
    "WRONG_ORGANISATION": "linked to a different college or company than the fixture",
    "ORGANISATION_NOT_APPROVED": "the student's college is not active and approved",
    "CREDENTIALS_NOT_SUPPLIED": "E2E_<ROLE>_EMAIL / E2E_<ROLE>_PASSWORD are not set for the test run",
}


def is_uuid(value):
    return bool(UUID.match(value or ""))


def resolve_database_id(identity_uid, mapping):
    """What auth-bridge + resolve_account_uuid would return. `mapping` is the
    account_identities row for this Identity id, None if absent, or "UNKNOWN" if not read."""
    if is_uuid(identity_uid):
        return identity_uid.lower()
    if mapping == "UNKNOWN":
        return "UNKNOWN"
    return (mapping or {}).get("user_id")


def login_identity(expect, db):
    """A port of web_login_identity (migration 102) over facts already read. Returns a reason."""
    role = (db.get("user_role") or {}).get("role")

    if not role:
        return "ACCOUNT_NOT_PROVISIONED"
    if role != expect["role"]:
        return "WRONG_ROLE"

    if role == "admin":
        return "OK"

    if role == "student":
        profile = db.get("student")
        if not profile or not profile.get("has_name") or not profile.get("college_id"):
            return "PROFILE_MISSING"
        if profile.get("status") != "active" or profile.get("onboarding_status") == "blocked":
            return "SUSPENDED"
        if expect.get("org") and profile["college_id"] != expect["org"]:
            return "WRONG_ORGANISATION"
        college = db.get("student_college") or {}
        if college.get("status") != "active" or college.get("verification_status") != "approved":
            return "ORGANISATION_NOT_APPROVED"
        return "OK"

    org = db.get("college" if role == "college_admin" else "company")
    if not org:
        return "PROFILE_MISSING"
    if org.get("status") == "suspended" or org.get("verification_status") == "rejected":
        return "SUSPENDED"
    if expect.get("org") and org.get("id") != expect["org"]:
        return "WRONG_ORGANISATION"
    return "OK"


def assess(expect, identities, mapping="UNKNOWN", db=None, credentials=True):
    """One role. `identities` = Identity accounts found for the fixture address (dicts with
    localId, disabled, has_password). `db` = facts about the FIXTURE database account, or None."""
    if not identities:
        return BLOCKED, "IDENTITY_MISSING"
    if len(identities) > 1:
        return BLOCKED, "IDENTITY_AMBIGUOUS"

    login = identities[0]

    if login.get("disabled"):
        return BLOCKED, "IDENTITY_DISABLED"
    if not login.get("has_password"):
        return BLOCKED, "IDENTITY_NO_PASSWORD"

    database_id = resolve_database_id(login.get("localId", ""), mapping)

    if database_id == "UNKNOWN":
        return BLOCKED, "DB_NOT_CHECKED"
    if not database_id:
        return BLOCKED, "DB_MAPPING_MISSING"
    if database_id.lower() != expect["id"].lower():
        return BLOCKED, "UID_MISMATCH"
    if db is None:
        return BLOCKED, "DB_NOT_CHECKED"

    reason = login_identity(expect, db)

    if reason != "OK":
        return BLOCKED, reason
    if not credentials:
        return BLOCKED, "CREDENTIALS_NOT_SUPPLIED"
    return READY, "OK"


# ---------------------------------------------------------------------------
# Live reads. Everything below only asks questions.
# ---------------------------------------------------------------------------

def gcloud_token():
    gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not gcloud:
        raise SystemExit("gcloud was not found")
    out = subprocess.run([gcloud, "auth", "print-access-token"], capture_output=True, text=True, timeout=TIMEOUT)
    if out.returncode != 0 or not out.stdout.strip():
        raise SystemExit("gcloud is not signed in (details withheld)")
    return out.stdout.strip()


def identity_lookup(email, token):
    """Identity accounts for ONE address. accounts:lookup is a POST by Google's design; it only reads."""
    request = urllib.request.Request(
        LOOKUP_URL, data=json.dumps({"email": [email]}).encode(), method="POST",
        headers={"Authorization": f"Bearer {token}", "x-goog-user-project": PROJECT,
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            users = json.loads(response.read().decode()).get("users", [])
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Identity lookup refused: HTTP {error.code} (details withheld)") from None
    return [{"localId": u.get("localId", ""), "disabled": bool(u.get("disabled")),
             "has_password": bool(u.get("passwordHash")) or "passwordUpdatedAt" in u} for u in users]


# The only database questions this tool can ask: table -> columns. GET only.
DB_READS = {
    "account_identities": "user_id",
    "user_roles": "role",
    "student_profiles": "full_name,college_id,status,onboarding_status",
    "colleges": "id,status,verification_status",
    "startups": "id,status,verification_status",
}
FILTER = re.compile(r"^(provider_uid|user_id|id)=eq\.[A-Za-z0-9-]{1,128}$")


def staging_get(table, row_filter, fetch):
    """One fixed, read-only question to the STAGING database. Returns the first row or None."""
    if table not in DB_READS or not FILTER.match(row_filter):
        raise ValueError("refused: not an allowed staging read")
    status, rows = fetch(f"{STAGING_API}/{table}?select={DB_READS[table]}&{row_filter}&limit=1")
    if status != 200 or not isinstance(rows, list):
        raise SystemExit(f"staging read of {table} failed: HTTP {status} (details withheld)")
    return rows[0] if rows else None


def staging_fetcher():
    """GET with the staging test-tooling credential from st.py. The credential stays in memory."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import st  # noqa: E402  (staging-only helper; it has no production address)

    headers = {"Authorization": f"Bearer {st.token('svc')}"}
    return lambda url: st.http(url, None, headers, "GET")


def database_facts(expect, fetch):
    """Facts about the fixture's own database account."""
    user = f"user_id=eq.{expect['id']}"
    student = staging_get("student_profiles", user, fetch)
    facts = {
        "user_role": staging_get("user_roles", user, fetch),
        "college": staging_get("colleges", user, fetch),
        "company": staging_get("startups", user, fetch),
        "student": None,
        "student_college": None,
    }
    if student:
        # Only whether a name exists is kept, never the name.
        facts["student"] = {"has_name": bool(student.get("full_name")), "college_id": student.get("college_id"),
                            "status": student.get("status"), "onboarding_status": student.get("onboarding_status")}
        if is_uuid(student.get("college_id") or ""):
            facts["student_college"] = staging_get("colleges", f"id=eq.{student['college_id']}", fetch)
    return facts


def run(lookup, fetch=None, environ=os.environ):
    results = {}
    for name, expect in ROLES.items():
        identities = lookup(expect["email"])
        mapping, db = "UNKNOWN", None
        if fetch:
            db = database_facts(expect, fetch)
            uid = identities[0]["localId"] if len(identities) == 1 else ""
            mapping = None
            if uid and not is_uuid(uid) and re.match(r"^[A-Za-z0-9-]{1,128}$", uid):
                mapping = staging_get("account_identities", f"provider_uid=eq.{uid}", fetch)
        credentials = bool(environ.get(f"E2E_{name}_EMAIL")) and bool(environ.get(f"E2E_{name}_PASSWORD"))
        status, reason = assess(expect, identities, mapping, db, credentials)
        # The fixture's own database account, judged apart from any login.
        fixture = login_identity(expect, db) if db is not None else "DB_NOT_CHECKED"
        results[name] = {"status": status, "reason": reason, "fixture_database_account": fixture}
    return results


def main():
    if [a for a in sys.argv[1:] if a != "--read-staging-db"]:
        raise SystemExit("usage: teja_s29_role_readiness.py [--read-staging-db]")
    token = gcloud_token()
    fetch = staging_fetcher() if "--read-staging-db" in sys.argv else None
    results = run(lambda email: identity_lookup(email, token), fetch)

    print("S29 FIVE-ROLE READINESS (read-only; staging)")
    for name, result in results.items():
        print(f"  {name:<12} {result['status']:<8} REASON={result['reason']:<26} "
              f"FIXTURE_DB_ACCOUNT={result['fixture_database_account']}")
        print(f"  {'':<12} {REASONS[result['reason']]}")
    ready = sum(result["status"] == READY for result in results.values())
    print(f"IDENTITY_READY_COUNT={ready}/5")
    print("Nothing was created or changed.")
    return 0 if ready == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
