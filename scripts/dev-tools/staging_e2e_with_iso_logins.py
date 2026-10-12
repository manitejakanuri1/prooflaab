"""STAGING ONLY. Runs Sidhu's live suite (sidhu_s32_live_e2e.mjs) with the isolated-pool fixture logins supplied in
memory as E2E_<ROLE>_EMAIL / _PASSWORD / _USER_ID. Nothing is printed or written except the suite's own output.

    python scripts/dev-tools/staging_e2e_with_iso_logins.py --expect-entry index-XXXX.js [extra suite args]

Each role's login is found by signing in through the staging site and reading /api/auth/session, so the mapping
is the live one, not a guess.
"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import staging_rc_chain_check as chain  # noqa: E402

chain.BASE = "https://prooflab-staging.web.app"
ROLE_ENV = {"admin": "ADMIN", "tpo": "TPO", "company": "COMPANY", "student": "STUDENT", "student_established": "ESTABLISHED"}

env = dict(os.environ)
for email, pw in chain.logins().items():
    call = chain.client()
    if call("POST", "/api/auth/login", {"email": email, "password": pw})[0] != 200:
        continue
    st, s = call("GET", "/api/auth/session")
    uid = (((s or {}).get("session") or {}).get("user") or (s or {}).get("user") or {}).get("id")
    call("POST", "/api/auth/logout", {})
    role = chain.WANT.get(uid)
    if role:
        k = ROLE_ENV[role]
        env[f"E2E_{k}_EMAIL"], env[f"E2E_{k}_PASSWORD"], env[f"E2E_{k}_USER_ID"] = email, pw, uid
found = sorted(k for k in ROLE_ENV.values() if f"E2E_{k}_EMAIL" in env)
print(f"roles supplied: {found}", flush=True)
sys.exit(subprocess.call(["node", "scripts/dev-tools/sidhu_s32_live_e2e.mjs", "--confirm-staging", *sys.argv[1:]], env=env))
