"""STAGING ONLY, live. College imports ONE new disposable student, then removes it, through the real website routes.

    python scripts/dev-tools/staging_college_removal_e2e.py

Uses only: the staging site (https://prooflab-staging.web.app/api/...), the isolated staging Identity project
(prooflab-stg-identity-508214) and the E2E fixture logins (secret prooflab-staging-iso-fixture-logins). The new
student's address is on a reserved test domain (.invalid). Prints no password, token or address.
Writes its evidence (ids, statuses) to e2e-out/college-removal.json for the database checks.
"""
import http.cookiejar, json, os, shutil, subprocess, sys, time, urllib.error, urllib.request

SITE = "https://prooflab-staging.web.app"
IDP = "prooflab-stg-identity-508214"
HERE = os.path.dirname(os.path.abspath(__file__))
E2E = json.load(open(os.path.join(HERE, "staging_fixtures.json"), encoding="utf-8"))
GCLOUD = shutil.which("gcloud") or "gcloud"
RESULTS, EVIDENCE = [], {}


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok)))
    print(f"{'PASS' if ok else 'FAIL'} {name} {detail}")


def gc(*args):
    return subprocess.run([GCLOUD, *args], capture_output=True, text=True, check=True).stdout.strip()


def client():
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(method, path, body=None):
        req = urllib.request.Request(SITE + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Origin": SITE, "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with op.open(req, timeout=120) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {"raw": raw[:150].decode(errors="replace")}
    return call


def session_user(call):
    st, s = call("GET", "/api/auth/session")
    s = s or {}
    return ((s.get("session") or {}).get("user") or s.get("user") or {}).get("id")


def sign_in_as(want_id=None, role=None, exclude=()):
    """Sign in with a fixture login whose app account is want_id, or (role) any other account of that role."""
    for email, pw in LOGINS.items():
        call = client()
        if call("POST", "/api/auth/login", {"email": email, "password": pw})[0] != 200:
            continue
        uid = session_user(call)
        if want_id and uid == want_id:
            return call, uid
        if role and uid not in exclude:
            st, r = call("GET", f"/api/db/user_roles?select=role&user_id=eq.{uid}")
            if st == 200 and r and r[0]["role"] == role:
                return call, uid
        call("POST", "/api/auth/logout", {})
    return None, None


def identity(path, body):
    tok = gc("auth", "print-access-token")
    req = urllib.request.Request(f"https://identitytoolkit.googleapis.com/v1/projects/{IDP}/{path}", data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {tok}", "x-goog-user-project": IDP, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


LOGINS = json.loads(gc("secrets", "versions", "access", "latest", "--secret=prooflab-staging-iso-fixture-logins",
                       "--project=prooflab-508214"))


def main():
    tpo, tpo_id = sign_in_as(want_id=E2E["tpo"])
    check("college (E2E TPO) signs in on the staging site", tpo)
    if not tpo:
        return
    st, cols = tpo("GET", "/api/db/colleges?select=id")
    college = cols[0]["id"] if st == 200 and cols else None
    check("college reads its own college id", college)

    # 1. import one disposable student (the real create-student-users function)
    stamp = time.strftime("%m%d%H%M%S")
    email = f"rc41-removal-{stamp}@disposable.staging.invalid"
    st, out = tpo("POST", "/api/functions/create-student-users", {"college_id": college, "students": [
        {"name": f"RC41 Disposable {stamp}", "email": email, "roll_number": f"RC41-{stamp}", "branch": "CSE",
         "batch": "2027", "year_of_study": "2027"}]})
    check("import of one disposable student answers 200", st == 200, f"HTTP {st}")
    st, lst = identity("accounts:lookup", {"email": [email]})
    uid_g = ((lst or {}).get("users") or [{}])[0].get("localId")
    check("its login was created in the ISOLATED staging Identity project", uid_g)
    time.sleep(3)
    st, rows = tpo("POST", "/api/db/rpc/tpo_students", {})
    sid = next((r.get("id") or r.get("student_id") for r in (rows or []) if isinstance(r, dict)
                and str(r.get("roll_number") or "") == f"RC41-{stamp}"), None) if st == 200 else None
    if not sid:
        st, pr = tpo("GET", f"/api/db/student_profiles?select=id&roll_number=eq.RC41-{stamp}")
        sid = pr[0]["id"] if st == 200 and pr else None
    check("the college sees the new student", sid)
    EVIDENCE.update({"student_id": sid, "provider_uid": uid_g, "college_id": college, "tpo_id": tpo_id})
    if not (sid and uid_g):
        return

    # 2. give the disposable login a password (isolated pool only) and open a student session
    pw = os.urandom(12).hex()
    identity("accounts:update", {"localId": uid_g, "password": pw})
    stu = client()
    st, _ = stu("POST", "/api/auth/login", {"email": email, "password": pw})
    check("disposable student signs in (session to be revoked later)", st == 200 and session_user(stu) == sid, f"HTTP {st}")

    # 3. refusals: company, another college, the student itself without DELETE, a student for someone else
    co, _ = sign_in_as(want_id=E2E["company"])
    st, out = co("POST", "/api/accounts/remove", {"student_ids": [sid]})
    check("company cannot remove a student", st in (401, 403), f"HTTP {st}")
    other, other_id = sign_in_as(role="college_admin", exclude=(tpo_id,))
    if other:
        st, out = other("POST", "/api/accounts/remove", {"student_ids": [sid]})
        check("another college cannot remove this college's student", st == 403, f"HTTP {st}")
    else:
        check("another college cannot remove this college's student", False, "no second college fixture login")
    est, _ = sign_in_as(want_id=E2E["student_established"])
    st, out = est("POST", "/api/accounts/remove", {"student_ids": [sid], "confirm": "DELETE"})
    check("a student cannot remove another student", st in (401, 403), f"HTTP {st}")
    st, still = tpo("GET", f"/api/db/student_profiles?select=id&id=eq.{sid}")
    check("after the refusals the student still exists", st == 200 and len(still or []) == 1)

    # 4. the college removes its own student
    st, out = tpo("POST", "/api/accounts/remove", {"student_ids": [sid]})
    EVIDENCE["remove_answer"] = {"status": st, "removed": (out or {}).get("removed"), "login_pending": (out or {}).get("login_pending")}
    check("college removes its own student: 200, removed 1", st == 200 and (out or {}).get("removed") == 1, f"HTTP {st} {out}")
    check("Google login deleted at once (no retry needed)", (out or {}).get("login_pending") == 0)
    st, lk = identity("accounts:lookup", {"localId": [uid_g]})
    check("the login is gone from the isolated pool", st == 200 and not (lk or {}).get("users"))

    # 5. the student's open session and old ticket are refused
    st, s = stu("GET", "/api/auth/session")
    check("the removed student's open session is no longer signed in", session_user(stu) is None, f"HTTP {st}")
    st, _ = stu("GET", "/api/db/user_roles?select=role")
    check("the removed student's session cannot read data", st in (401, 403) or _ == [], f"HTTP {st}")

    # 6. repeat removal is safe
    st, out = tpo("POST", "/api/accounts/remove", {"student_ids": [sid]})
    EVIDENCE["repeat_answer"] = {"status": st, "removed": (out or {}).get("removed")}
    check("repeating the removal changes nothing (removed 0 or a clean refusal)", (st == 200 and (out or {}).get("removed") == 0) or st in (403, 404, 409), f"HTTP {st}")

    # 7. squads: the empty-squads prompt never erases a squad with history (migration 112)
    st, n_empty = tpo("POST", "/api/db/rpc/tpo_empty_squads", {})
    EVIDENCE["tpo_empty_squads"] = n_empty
    check("college reads the empty-squad count", st == 200, f"HTTP {st} count={n_empty}")
    for c in (tpo, co, est):
        c("POST", "/api/auth/logout", {})


if __name__ == "__main__":
    try:
        main()
    finally:
        os.makedirs("e2e-out", exist_ok=True)
        json.dump({"evidence": EVIDENCE, "results": RESULTS}, open("e2e-out/college-removal.json", "w"), indent=1)
        failed = [n for n, ok in RESULTS if not ok]
        print(f"\n{len(RESULTS) - len(failed)} PASS, {len(failed)} FAIL")
        sys.exit(1 if failed else 0)
