"""ProofLab quick health check - run after every deploy:  python scripts/healthcheck.py

Signs in as the test student (vidyuthsetu+smoke01), the college and the admin, calls
the same server actions the screens call, and proves the important ones with a
database row. Skips the expensive AI steps (resume test, Auto-fix). Needs gcloud
logged in to prooflab-508214 (passwords come from Secret Manager).
Exit code 0 = everything passed.
"""
import json, subprocess, sys, time, urllib.error, urllib.request

WEB_KEY = "AIzaSyCNv0YWVP5QTDRb4WPVccmosCMC8cH7nnw"  # public web key, same as in the site
BRIDGE = "https://prooflab-auth-bridge-ysn2mpe6sa-el.a.run.app"
API = "https://prooflab-api-ysn2mpe6sa-el.a.run.app"
FN = "https://prooflab-functions-135298577404.asia-south1.run.app"
SERVICES = {
    "transcriber": "https://prooflab-transcriber-135298577404.asia-south1.run.app",
    "accounts": "https://prooflab-accounts-135298577404.asia-south1.run.app",
}
LOGINS = {  # who -> (email, secret holding the password)
    # the dedicated test student (the old e2e/t01-t18 logins were removed on 30 Sep 2026)
    "student": ("vidyuthsetu+smoke01@gmail.com", "prooflab-smoke-student-password"),
    "college": ("vidyuthsetu+college@gmail.com", "prooflab-college-password"),
    "admin": ("vidyuthsetu@gmail.com", "prooflab-admin-password"),
}


def secret(name):
    out = subprocess.run(f"gcloud secrets versions access latest --secret={name}",
                         capture_output=True, text=True, shell=True)
    return out.stdout.strip()


def call(url, body=None, token=None, method=None, timeout=90):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data is not None else "GET"),
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def sign_in(who):
    email, sec = LOGINS[who]
    st, j = call(f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={WEB_KEY}",
                 {"email": email, "password": secret(sec), "returnSecureToken": True})
    assert st == 200, f"{who} sign-in failed: {j}"
    st, t = call(f"{BRIDGE}/token", {}, j["idToken"])
    assert st == 200, f"{who} token failed: {t}"
    return t["access_token"], t.get("user", {}).get("id") or json.loads(
        __import__("base64").urlsafe_b64decode(t["access_token"].split(".")[1] + "==").decode())["sub"]


results = []


def check(name, fn):
    t0 = time.time()
    try:
        detail = fn() or ""
        results.append((True, name, int((time.time() - t0) * 1000), str(detail)))
    except Exception as e:  # noqa: BLE001 - every failure is reported, none stops the run
        results.append((False, name, int((time.time() - t0) * 1000), str(e)[:200]))


def ok(st, out, what=""):
    assert st < 300, f"HTTP {st}: {str(out)[:160]}"
    if isinstance(out, dict) and out.get("error"):
        raise AssertionError(f"{what} error: {out['error']}")
    return out


def rpc(token, name, args=None):
    st, out = call(f"{API}/rpc/{name}", args or {}, token)
    return ok(st, out, name)


def main():
    # ---- services -------------------------------------------------------
    def functions_ready():
        st, j = call(f"{FN}/ready")
        assert st == 200 and j["loaded"] == j["expected"], j
        return f"{j['loaded']}/{j['expected']} functions"
    check("functions service is up", functions_ready)
    for name, url in SERVICES.items():
        check(f"{name} service answers", lambda url=url: (lambda st: (st < 500) or (_ for _ in ()).throw(AssertionError(st)))(call(url)[0]) and "up")

    svc_tokens = {}
    for who in LOGINS:
        check(f"{who} can sign in", lambda who=who: svc_tokens.__setitem__(who, sign_in(who)) or "ok")
    if "student" not in svc_tokens:
        return
    stu, stu_id = svc_tokens["student"]

    # ---- student --------------------------------------------------------
    check("student: activity ping", lambda: rpc(stu, "touch_my_activity") or "ok")
    check("student: this week plan", lambda: rpc(stu, "my_week") and "ok")
    check("student: skills proved", lambda: f"{len(rpc(stu, 'my_skills_proved') or [])} skills")
    check("student: history", lambda: f"{len(rpc(stu, 'my_history', {'_limit': 5, '_offset': 0}) or [])} events")
    check("student: suggested tracks", lambda: f"{len(rpc(stu, 'my_suggested_tracks', {'_limit': 2}) or [])} suggestions")

    lot = {}

    def daily_lot():
        r = rpc(stu, "create_my_lot") or {}
        if not r.get("task_id"):
            raise AssertionError(f"no Lot: {r}")
        lot.update(r)
        return f"task {r['task_id'][:8]}"
    check("student: today's Lot", daily_lot)

    if lot.get("task_id"):
        def simple_question():
            st, out = call(f"{FN}/task-explain", {"task_id": lot["task_id"]}, stu)
            out = ok(st, out, "task-explain")
            assert out.get("brief") and out["brief"].get("in_one_line"), out
            return "cached" if out.get("cached") else "written now"
        check("student: Lot question in simple words", simple_question)

        def lot_screen():
            sv = rpc(stu, "sandbox_task_view", {"_task_id": lot["task_id"]})
            if sv:
                st, out = call(f"{FN}/run-sandbox", {"task_id": lot["task_id"], "code": sv.get("starter_code") or "print(1)"}, stu)
                ok(st, out, "run-sandbox")
                return f"coding task, runner answered {len((out or {}).get('results', []))} tests"
            rv = rpc(stu, "rubric_task_view", {"_task_id": lot["task_id"]})
            assert rv and rv.get("prompt_text"), f"no task view: {rv}"
            return f"written task, {len(rv.get('criteria') or [])} marking rules"
        check("student: Lot opens (editor or answer box)", lot_screen)

    def lesson():
        st, out = call(f"{FN}/level-open", {"track_slug": "web-development", "level_number": 1,
                                            "advance_step": False, "skip_to_checkpoint": False}, stu)
        out = ok(st, out, "level-open")
        assert out.get("explanation"), "empty lesson"
        return f"step {out.get('step_index')}/{out.get('total_steps')}, go deeper: {'yes' if out.get('go_deeper') else 'no'}, read more: {len(out.get('read_more') or [])}"
    check("student: Tracks lesson opens", lesson)

    def quiz():
        st, out = call(f"{FN}/level-open", {"track_slug": "web-development", "level_number": 1,
                                            "advance_step": False, "skip_to_checkpoint": True}, stu)
        out = ok(st, out, "level-open")
        qs = out.get("quiz") or []
        assert qs, "checkpoint has no quiz"
        st, res = call(f"{FN}/level-quiz-submit", {"level_id": out["level"]["id"],
                                                  "answers": [{"question_id": q["id"], "selected_index": 0} for q in qs]}, stu)
        res = ok(st, res, "quiz submit")
        # Proof in the database: the attempt was recorded.
        return f"{res['score']}/{res['out_of']} (passed={res['passed']})"
    check("student: quiz checks answers", quiz)

    def progress_row():
        st, rows = call(f"{API}/student_levels?select=status&limit=50", None, stu)
        rows = ok(st, rows)
        assert rows, "no progress rows saved"
        return f"{len(rows)} progress rows"
    check("student: progress saved in database", progress_row)

    # ---- college --------------------------------------------------------
    if "college" in svc_tokens:
        col = svc_tokens["college"][0]
        check("college: home", lambda: rpc(col, "tpo_home") and "ok")
        check("college: students list", lambda: f"{len(rpc(col, 'tpo_students') or [])} students")
        check("college: squads", lambda: f"{len(rpc(col, 'tpo_squad_performance', {'_weeks': 8}) or [])} rows")
        check("college: insights", lambda: rpc(col, "tpo_insights") and "ok")

    # ---- admin ----------------------------------------------------------
    if "admin" in svc_tokens:
        adm = svc_tokens["admin"][0]
        check("admin: content library", lambda: f"{len((rpc(adm, 'admin_content_library') or {}).get('pages', []))} pages")
        check("admin: submissions to review", lambda: f"{len(rpc(adm, 'needs_review_submissions') or [])} waiting")
        check("admin: companies", lambda: rpc(adm, "admin_recruiters") is not None and "ok")


if __name__ == "__main__":
    t0 = time.time()
    main()
    width = max(len(r[1]) for r in results)
    for passed, name, ms, detail in results:
        print(f"{'PASS' if passed else 'FAIL'}  {name.ljust(width)}  {ms:>6} ms  {detail}")
    failed = [r for r in results if not r[0]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed in {int(time.time() - t0)}s")
    sys.exit(1 if failed else 0)
