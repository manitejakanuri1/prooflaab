"""READ-ONLY. Do the five staging test fixtures have a usable Google Identity login? Nothing is changed.

    python scripts/dev-tools/identity_fixture_preflight.py

Why it exists: a fixture is a row in the STAGING DATABASE. A login is an account in GOOGLE IDENTITY
PLATFORM. They are different things, and staging and production share ONE Identity pool
(project prooflab-508214). A fixture can only be signed in to if a login exists that the auth-bridge
maps onto the fixture's database id. The mapping (auth-bridge/main.ts -> resolve_account_uuid, migration 05):

    Identity UID looks like a uuid   -> the database id IS that uuid (same in every database)
    otherwise                        -> the row in public.account_identities OF THAT DATABASE decides
                                        (no row: a brand-new random id is made at first sign-in)

What it does, and all it does (project and addresses are fixed in this file, not arguments):
  * GET  the Identity Platform project configuration        (is email + password sign-in on? tenants?)
  * GET  the tenant list                                    (only to classify the answer)
  * POST accounts:lookup for each fixture email and each fixture id - a QUERY; it returns, it never writes

It never signs in, never sends or reads a password, never creates, edits, disables or deletes an account,
never touches a database, and asks only about the five fixtures: no other account is ever listed.
Printed: yes/no facts and categories. Never printed: a token, an Identity UID, a password hash, any
field of any account, or an error body.

Exit 0 only if all five fixtures are READY. NEEDS_DB_CHECK and NOT_READY are not READY (fail closed).
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
IDENTITY = "https://identitytoolkit.googleapis.com"
CONFIG_URL = f"{IDENTITY}/admin/v2/projects/{PROJECT}/config"
TENANTS_URL = f"{IDENTITY}/v2/projects/{PROJECT}/tenants"
LOOKUP_URL = f"{IDENTITY}/v1/projects/{PROJECT}/accounts:lookup"
# Everything this tool may call. accounts:lookup is a POST by Google's design but is a pure query.
ALLOWED = {("GET", CONFIG_URL), ("GET", TENANTS_URL), ("POST", LOOKUP_URL)}
TIMEOUT = 30

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
SAFE_CODE = re.compile(r"^[A-Z][A-Z0-9_]{2,60}$")

# role -> (key in staging_fixtures.json, sign-in address the browser tests use, E2E_<NAME>_ variables).
# The addresses are the ones in scripts/dev-tools/staging_browser_e2e.mjs (reserved .invalid test domains).
FIXTURES = {
    "admin": ("admin", "e2e.admin@staging.prooflab.invalid", "ADMIN"),
    "tpo": ("tpo", "college@staging.prooflab.invalid", "TPO"),
    "company": ("company", "probe.company@test.invalid", "COMPANY"),
    "student": ("student", "e2e.student@staging.prooflab.invalid", "STUDENT"),
    "established": ("student_established", "student1@staging.prooflab.invalid", "ESTABLISHED"),
}
FIXTURE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "staging_fixtures.json")

# What a lookup can mean for one fixture.
EXACT = "EXACT"                          # a login whose UID is the fixture id and whose email is the fixture email
NEEDS_MAPPING = "EMAIL_ONLY_GOOGLE_UID"  # email exists; UID is Google-made, so only account_identities can map it
WRONG_UUID = "EMAIL_ONLY_OTHER_UUID"     # email exists; UID is a different uuid: it can never be this fixture
UID_OTHER_EMAIL = "UID_HAS_OTHER_EMAIL"  # the fixture id is a login, but under another address
SPLIT = "EMAIL_AND_UID_ARE_TWO_LOGINS"   # both exist, as two different logins
ABSENT = "ABSENT"
AMBIGUOUS = "AMBIGUOUS"                  # more than one account answered: never guess


def access_token():
    """The signed-in gcloud user's own short-lived token. Held in memory only; never printed or stored."""
    gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not gcloud:
        raise RuntimeError("gcloud was not found")
    out = subprocess.run([gcloud, "auth", "print-access-token"], capture_output=True, text=True, timeout=60)
    token = out.stdout.strip()
    if out.returncode != 0 or not token:
        raise RuntimeError("gcloud has no usable sign-in")
    return token


def identity_call(method, url, body=None, token=None):
    """One allowed call. Returns (status, parsed JSON or None). Anything not on the list is refused."""
    if (method, url) not in ALLOWED:
        raise PermissionError("this tool may not call that")
    if method == "POST":
        key, values = next(iter((body or {}).items()), (None, None))
        if len(body or {}) != 1 or key not in ("email", "localId") or not isinstance(values, list) or len(values) != 1:
            raise PermissionError("a lookup asks about exactly one fixture, by email or by id")
    request = urllib.request.Request(
        url, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token}", "x-goog-user-project": PROJECT, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as res:
            status, raw = res.status, res.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    try:
        return status, json.loads(raw or b"{}")
    except ValueError:
        return status, None


def error_code(body):
    """Google's short machine code for an error (e.g. INVALID_PROJECT_ID), or 'withheld'. Never free text."""
    error = body.get("error") if isinstance(body, dict) else None
    error = error if isinstance(error, dict) else {}
    for candidate in (error.get("message"), error.get("status")):
        if isinstance(candidate, str) and SAFE_CODE.match(candidate):
            return candidate
    return "withheld"


def load_fixture_ids(path=FIXTURE_FILE):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    ids = {}
    for role, (key, _email, _var) in FIXTURES.items():
        value = data.get(key)
        if not isinstance(value, str) or not UUID.match(value):
            raise ValueError(f"staging_fixtures.json has no valid id for '{key}'")
        ids[role] = value.lower()
    if len(set(ids.values())) != len(ids):
        raise ValueError("two fixtures share one id")
    return ids


def classify(fixture_id, email, by_email, by_uid):
    """Category for one fixture from the two lookup answers (lists of account records). Reads only uid and email."""
    if len(by_email) > 1 or len(by_uid) > 1:
        return AMBIGUOUS
    e, u = (by_email[0] if by_email else None), (by_uid[0] if by_uid else None)
    uid_of = lambda a: str((a or {}).get("localId") or "").lower()  # noqa: E731
    mail_of = lambda a: str((a or {}).get("email") or "").lower()  # noqa: E731
    if e and u:
        return EXACT if uid_of(e) == uid_of(u) == fixture_id and mail_of(u) == email else SPLIT
    if u:
        return UID_OTHER_EMAIL
    if e:
        if uid_of(e) == fixture_id:
            return AMBIGUOUS      # the id lookup said "nobody" but the address lookup returned that id: do not guess
        return WRONG_UUID if UUID.match(uid_of(e)) else NEEDS_MAPPING
    return ABSENT


def usable(account):
    """Can this login be signed in to with a password at all? (enabled, has a password). Booleans only."""
    providers = {p.get("providerId") for p in account.get("providerUserInfo") or []}
    return {"enabled": not account.get("disabled", False), "has_password": bool(account.get("passwordHash")) and "password" in providers}


VERDICT_TEXT = {
    EXACT: "a login with the fixture's own id and address exists",
    NEEDS_MAPPING: "the address has a login, but its id was made by Google (not the fixture id): it is this fixture "
                   "ONLY IF staging's account_identities maps it to the fixture id - not checkable from here",
    WRONG_UUID: "the address has a login under a DIFFERENT uuid: it signs in as another account, never this fixture",
    UID_OTHER_EMAIL: "the fixture id is a login, but under another address",
    SPLIT: "the address and the fixture id belong to two different logins",
    ABSENT: "no login with this address or this id in the default tenant",
    AMBIGUOUS: "more than one account answered; refusing to guess",
}


def run(call=identity_call, token_source=access_token, fixture_ids=None, environ=None):
    """(ok, name, detail) lines plus per-role verdicts. `ok` is True/False, or None for information only."""
    environ = os.environ if environ is None else environ
    lines, verdicts = [], {}

    def line(ok, name, detail=""):
        lines.append((ok, name, detail))

    try:
        ids = load_fixture_ids() if fixture_ids is None else fixture_ids
    except Exception as error:
        line(False, "fixtures: ids can be read from staging_fixtures.json", type(error).__name__)
        return lines, verdicts
    line(True, "fixtures: five ids read from staging_fixtures.json")

    try:
        token = token_source()
    except Exception as error:
        line(False, "access: gcloud sign-in available", type(error).__name__)
        return lines, verdicts

    def ask(method, url, body=None):
        try:
            return call(method, url, body, token)
        except Exception as error:
            return None, {"_error": type(error).__name__}

    # ---- project configuration ------------------------------------------------------------------
    status, cfg = ask("GET", CONFIG_URL)
    if status != 200 or not isinstance(cfg, dict):
        line(False, "config: Identity Platform configuration can be read", f"HTTP {status}, {error_code(cfg)}")
        return lines, verdicts
    email_cfg = (cfg.get("signIn") or {}).get("email") or {}
    line(email_cfg.get("enabled") is True and email_cfg.get("passwordRequired") is True,
         "config: email + password sign-in is enabled", f"enabled={email_cfg.get('enabled')}, passwordRequired={email_cfg.get('passwordRequired')}")
    tenants_on = (cfg.get("multiTenant") or {}).get("allowTenants") is True
    line(None, "config: multi-tenancy", "ENABLED" if tenants_on else "NOT enabled (allowTenants is not set)")

    status, body = ask("GET", TENANTS_URL)
    if status == 200 and isinstance(body, dict):
        count = len(body.get("tenants") or [])
        line(count == 0, "tenants: none exist besides the default tenant", f"{count} tenant(s) listed; their accounts are NOT covered below")
    elif not tenants_on and status == 400 and error_code(body) == "INVALID_PROJECT_ID":
        line(None, "tenants: list refused because multi-tenancy is off", "HTTP 400 INVALID_PROJECT_ID - consistent with tenancy being off; no tenant can be listed")
    else:
        line(False, "tenants: other tenants can be ruled out", f"HTTP {status}, {error_code(body)}")

    # ---- the five fixtures, default tenant --------------------------------------------------------
    for role, (_key, email, var) in FIXTURES.items():
        fixture_id = ids[role]
        answers = []
        for field, value in (("email", email), ("localId", fixture_id)):
            status, body = ask("POST", LOOKUP_URL, {field: [value]})
            if status != 200 or not isinstance(body, dict):
                answers = None
                line(False, f"{role}: lookup by {'address' if field == 'email' else 'fixture id'}", f"HTTP {status}, {error_code(body)}")
                break
            answers.append([a for a in body.get("users") or [] if isinstance(a, dict)])
        if answers is None:
            verdicts[role] = "NOT_READY"
            continue
        category = classify(fixture_id, email, *answers)
        account = (answers[1] or answers[0] or [None])[0]
        facts = usable(account) if account and category in (EXACT, NEEDS_MAPPING) else None
        has_env = bool(environ.get(f"E2E_{var}_EMAIL")) and bool(environ.get(f"E2E_{var}_PASSWORD"))
        env_matches = (environ.get(f"E2E_{var}_EMAIL") or "").strip().lower() == email

        if category == EXACT and facts["enabled"] and facts["has_password"] and has_env and env_matches:
            verdict = "READY"
        elif category == NEEDS_MAPPING and facts["enabled"] and facts["has_password"]:
            verdict = "NEEDS_DB_CHECK"
        else:
            verdict = "NOT_READY"
        verdicts[role] = verdict
        detail = f"{category}: {VERDICT_TEXT[category]}"
        if facts:
            detail += f"; enabled={facts['enabled']}, has_password={facts['has_password']}"
        detail += f"; E2E_{var}_EMAIL/_PASSWORD set={has_env}" + (f", address matches fixture={env_matches}" if has_env else "")
        line(verdict == "READY", f"{role}: {verdict}", detail)
    return lines, verdicts


def main():
    lines, verdicts = run()
    for ok, name, detail in lines:
        print({True: "PASS", False: "FAIL", None: "INFO"}[ok], name + (f" - {detail}" if detail else ""), flush=True)
    ready = sum(1 for v in verdicts.values() if v == "READY")
    failed = sum(1 for ok, _, _ in lines if ok is False)
    print(f"\nfixtures READY: {ready}/{len(FIXTURES)}  |  " + ", ".join(f"{r}={verdicts.get(r, 'NOT_CHECKED')}" for r in FIXTURES))
    print("Scope: default tenant of project " + PROJECT + ". No sign-in was attempted; no password was read.")
    ok = ready == len(FIXTURES) and failed == 0
    print(f"IDENTITY_FIXTURE_PREFLIGHT={'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
