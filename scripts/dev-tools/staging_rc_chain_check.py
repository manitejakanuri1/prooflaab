"""STAGING ONLY. Live check of a candidate chain (BFF -> isolated Identity -> auth-bridge -> PostgREST) through a
tagged, 0%-traffic BFF revision, for the staging E2E roles. Prints no address, password or token.

    python scripts/dev-tools/staging_rc_chain_check.py [tag]        (default tag rc41)

For each disposable fixture login (Secret Manager prooflab-staging-iso-fixture-logins) whose app account is one of
the E2E accounts (scripts/dev-tools/staging_fixtures.json): sign in through the tag URL, read /api/auth/session,
read the account's own role through /api/db (PostgREST with the bridge's ticket), log out, and prove the session is
gone. Exit 0 only when every E2E role passes.
"""
import http.cookiejar, json, os, shutil, subprocess, sys, urllib.error, urllib.request

TAG = sys.argv[1] if len(sys.argv) > 1 else "rc41"
BASE = ("https://prooflab-staging.web.app" if TAG == "site" else "https://prooflab-staging-web-bff-ysn2mpe6sa-el.a.run.app" if TAG == "main"
        else f"https://{TAG}---prooflab-staging-web-bff-ysn2mpe6sa-el.a.run.app")
ORIGIN = "https://prooflab-staging.web.app"
HERE = os.path.dirname(os.path.abspath(__file__))
E2E = json.load(open(os.path.join(HERE, "staging_fixtures.json"), encoding="utf-8"))
WANT = {v: k for k, v in E2E.items()}             # user id -> E2E role name


def logins():
    gcloud = shutil.which("gcloud") or "gcloud"
    return json.loads(subprocess.run([gcloud, "secrets", "versions", "access", "latest",
                                      "--secret=prooflab-staging-iso-fixture-logins", "--project=prooflab-508214"],
                                     capture_output=True, text=True, check=True).stdout)


def client():
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(method, path, body=None):
        req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Origin": ORIGIN, "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with op.open(req, timeout=60) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, raw[:120].decode(errors="replace")
    return call


def main():
    results, seen = {}, set()
    for email, pw in logins().items():
        call = client()
        st, out = call("POST", "/api/auth/login", {"email": email, "password": pw})
        if st != 200:
            continue
        st, sess = call("GET", "/api/auth/session")
        uid = (((sess or {}).get("session") or {}).get("user") or {}).get("id") or ((sess or {}).get("user") or {}).get("id")
        role_name = WANT.get(uid)
        if role_name:
            st2, roles = call("GET", f"/api/db/user_roles?select=role&user_id=eq.{uid}")
            api_ok = st2 == 200 and isinstance(roles, list) and len(roles) == 1
            call("POST", "/api/auth/logout", {})
            st3, after = call("GET", "/api/auth/session")
            gone = st3 in (200, 401) and not (((after or {}).get("session") or {}).get("user") if isinstance(after, dict) else None)
            results[role_name] = {"sign_in": True, "session_names_account": True, "api_as_user": api_ok,
                                  "db_role": roles[0]["role"] if api_ok else None, "logout_ends_session": gone}
            seen.add(role_name)
        else:
            call("POST", "/api/auth/logout", {})
    for name in E2E:
        r = results.get(name, {"sign_in": False})
        ok = all(v for k, v in r.items() if k != "db_role")
        print(f"{'PASS' if ok and len(r) > 1 else 'FAIL'} {name:20s} {json.dumps(r)}")
    sys.exit(0 if seen == set(E2E) and all(all(v for k, v in r.items() if k != 'db_role') for r in results.values()) else 1)


if __name__ == "__main__":
    main()
