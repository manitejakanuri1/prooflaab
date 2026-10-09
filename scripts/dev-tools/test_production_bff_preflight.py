"""The production BFF preflight is read-only, never accepts staging, never accepts an HTML page. All faked."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import production_bff_preflight as pre  # noqa: E402

SUFFIX = "-abc123-el.a.run.app"
URL = {name: f"https://{spec[0]}{SUFFIX}" for name, spec in pre.UPSTREAMS.items()}
BFF_URL = f"https://{pre.SERVICE}{SUFFIX}"
BFF_ACCOUNT = f"prooflab-rt-webbff@{pre.PROJECT}.iam.gserviceaccount.com"
SECRET_VALUE = "TEST-ONLY-NOT-A-REAL-VALUE-0123456789"
JSON = "application/json; charset=utf-8"
HTML = (200, "text/html; charset=utf-8", b"<!doctype html><title>ProofLab</title>BODY-MUST-NOT-APPEAR")


def svc(name, account, env=(), url=None, traffic=None):
    return {
        "metadata": {"name": name},
        "spec": {"template": {"spec": {"serviceAccountName": account, "containers": [{"env": list(env)}]}}},
        "status": {"url": url or f"https://{name}{SUFFIX}", "traffic": traffic if traffic is not None else [{"revisionName": f"{name}-00001-aaa", "percent": 100}]},
    }


def bff_env():
    env = [{"name": name, "value": url} for name, url in URL.items()]
    return env + [
        {"name": "BROWSER_ORIGINS", "value": "https://prooflab.co.in,https://prooflab-508214.web.app"},
        {"name": "GOOGLE_API_KEY", "value": SECRET_VALUE},
        {"name": "SESSION_KEY", "valueFrom": {"secretKeyRef": {"name": "prooflab-web-bff-session-key", "key": "latest"}}},
        {"name": "BFF_RELEASE_READY", "value": "true"},
    ]


def bridge_env(callers=BFF_ACCOUNT, signing=True):
    env = [{"name": "SERVICE_TOKEN_AUDIENCE", "value": URL["AUTH_BRIDGE_URL"]}, {"name": "SERVICE_TOKEN_CALLERS", "value": callers}]
    if signing:
        env.append({"name": "APP_SIGNING_KEY", "valueFrom": {"secretKeyRef": {"name": "prooflab-app-signing-key", "key": "latest"}}})
    return env


def cloud(with_bff=True):
    """Production as it must look to pass. Staging services are present too, as in the real project."""
    out = {spec[0]: svc(spec[0], f"prooflab-rt-{spec[0][9:]}@{pre.PROJECT}.iam.gserviceaccount.com") for spec in pre.UPSTREAMS.values()}
    out[pre.BRIDGE]["spec"]["template"]["spec"]["containers"][0]["env"] = bridge_env()
    out["prooflab-staging-web-bff"] = svc("prooflab-staging-web-bff", f"prooflab-staging-web-bff@{pre.PROJECT}.iam.gserviceaccount.com")
    if with_bff:
        out[pre.SERVICE] = svc(pre.SERVICE, BFF_ACCOUNT, bff_env())
    return out


def web():
    out = {
        f"{BFF_URL}/health": (200, JSON, {"ok": True, "service": "prooflab-web-bff"}),
        f"{BFF_URL}/ready": (200, JSON, {"ok": True, "service": "prooflab-web-bff", "state": "ready"}),
        f"{BFF_URL}/api/auth/session": (200, JSON, {"session": None}),
        f"{pre.SITE}/api/auth/session": (200, JSON, {"session": None}),
        f"{pre.SITE}{pre.PROTECTED[0]}": (401, JSON, {"error": "not authenticated"}),
    }
    for path in pre.PROTECTED:
        out[f"{BFF_URL}{path}"] = (401, JSON, {"error": "not authenticated"})
    for name, (service, path, code, field, value) in pre.UPSTREAMS.items():
        if path is not None:
            out[URL[name] + path] = (code, "application/json", {field: value})
    return out


def env_of(service):
    return service["spec"]["template"]["spec"]["containers"][0]["env"]


def set_env(service, name, value):
    for item in env_of(service):
        if item["name"] == name:
            item.clear()
            item.update({"name": name, "value": value})


class Production(unittest.TestCase):
    def go(self, services=None, answers=None, policy=None, read_error=None):
        services = cloud() if services is None else services
        answers = web() if answers is None else answers
        asked, commands = [], []

        def read(what):
            commands.append(what)
            if read_error and what in read_error:
                raise RuntimeError("gcloud could not read")
            if what == "list":
                return list(services.values())
            return policy if policy is not None else {"bindings": [{"role": "roles/run.invoker", "members": ["allUsers"]}]}

        def http(url, timeout):
            asked.append(url)
            self.assertTrue(timeout and timeout > 0)
            reply = answers.get(url)
            if reply is None:
                raise AssertionError(f"unexpected call to {url}")
            if isinstance(reply, Exception):
                raise reply
            code, ctype, body = reply
            return code, ctype, body if isinstance(body, bytes) else json.dumps(body).encode()

        results = pre.run(read=read, http=http)
        text = "\n".join(f"{ok} {name} {detail}" for ok, name, detail in results)
        return {name: ok for ok, name, _ in results}, asked, text, commands

    def failed(self, results):
        return sorted(name for name, ok in results.items() if not ok)

    def assert_fails(self, word, **kw):
        results, asked, text, _ = self.go(**kw)
        self.assertTrue([n for n in self.failed(results) if word in n], f"expected a failure mentioning '{word}', got {self.failed(results)}")
        return results, asked, text

    # ---- the good case, and today's real case ------------------------------------------------------

    def test_a_correct_production_passes(self):
        results, asked, _, commands = self.go()
        self.assertEqual(self.failed(results), [])
        self.assertGreaterEqual(len(results), 25)
        self.assertEqual(sorted(asked), sorted(web()))
        self.assertEqual(commands, ["list", "policy"])

    def test_no_production_bff_fails_and_the_staging_gateway_is_never_used_instead(self):
        answers = web()
        answers[f"{pre.SITE}/api/auth/session"] = HTML
        answers[f"{pre.SITE}{pre.PROTECTED[0]}"] = HTML
        results, asked, text, commands = self.go(services=cloud(with_bff=False), answers=answers)
        self.assertFalse(results[f"service: {pre.SERVICE} exists in production"])
        self.assertFalse(results["gateway: reachable at its own production address"])
        self.assertFalse(results["site: /api/auth/session answers BFF JSON (not the app page)"])
        self.assertIn("prooflab-staging-web-bff", text)
        self.assertIn("NOT accepted", text)
        self.assertFalse(any("staging" in url for url in asked), "no staging address may be contacted")
        self.assertEqual(commands, ["list"], "no policy read for a service that does not exist")
        self.assertGreaterEqual(len(self.failed(results)), 9)

    def test_a_staging_service_renamed_in_configuration_is_not_production(self):
        services = cloud(with_bff=False)
        services["prooflab-staging-web-bff"]["status"]["url"] = BFF_URL          # even with a production-looking address
        results, _, _, _ = self.go(services=services, answers={**web(), f"{pre.SITE}/api/auth/session": HTML, f"{pre.SITE}{pre.PROTECTED[0]}": HTML})
        self.assertFalse(results[f"service: {pre.SERVICE} exists in production"])

    # ---- HTML is never success ----------------------------------------------------------------------

    def test_the_app_page_on_an_api_path_is_a_failure_everywhere(self):
        for url in (f"{pre.SITE}/api/auth/session", f"{pre.SITE}{pre.PROTECTED[0]}", f"{BFF_URL}/health", f"{BFF_URL}/ready", f"{BFF_URL}/api/auth/session"):
            answers = web()
            answers[url] = HTML
            results, _, text, _ = self.go(answers=answers)
            self.assertEqual(len(self.failed(results)), 1, url)
            self.assertIn("HTML page (the website, not the API)", text)
            self.assertNotIn("BODY-MUST-NOT-APPEAR", text)

    def test_json_content_type_with_a_page_inside_is_a_failure(self):
        answers = web()
        answers[f"{pre.SITE}/api/auth/session"] = (200, JSON, b"<!doctype html>")
        self.assert_fails("site: /api/auth/session", answers=answers)

    # ---- readiness ------------------------------------------------------------------------------------

    def test_a_closed_ready_fails_and_names_what_the_gateway_reported(self):
        answers = web()
        answers[f"{BFF_URL}/ready"] = (503, JSON, {"ok": False, "service": "prooflab-web-bff", "state": "dependency-unhealthy", "failed": ["session-store"]})
        _, _, text = self.assert_fails("/ready is OPEN", answers=answers)
        self.assertIn("state=dependency-unhealthy", text)
        self.assertIn("failed=['session-store']", text)

    def test_ready_details_that_are_not_plain_names_are_withheld(self):
        answers = web()
        answers[f"{BFF_URL}/ready"] = (503, JSON, {"ok": False, "service": "prooflab-web-bff", "state": "x y; rm", "failed": ["https://leak.example/?k=v"]})
        _, _, text = self.assert_fails("/ready is OPEN", answers=answers)
        self.assertNotIn("leak.example", text)
        self.assertNotIn("rm", text.split("/ready is OPEN")[1].split("\n")[0].replace("proven", ""))

    def test_ready_claiming_ok_without_the_ready_state_or_from_another_service_fails(self):
        for body in ({"ok": True, "service": "prooflab-web-bff"}, {"ok": True, "service": "other", "state": "ready"}, {"ok": "true", "service": "prooflab-web-bff", "state": "ready"}):
            answers = web()
            answers[f"{BFF_URL}/ready"] = (200, JSON, body)
            self.assert_fails("/ready is OPEN", answers=answers)

    # ---- service ----------------------------------------------------------------------------------------

    def test_identity_problems_fail(self):
        for account in (f"135298577404{pre.DEFAULT_COMPUTE_SUFFIX}", f"prooflab-staging-web-bff@{pre.PROJECT}.iam.gserviceaccount.com",
                        "prooflab-rt-webbff@another-project.iam.gserviceaccount.com", f"prooflab-rt-functions@{pre.PROJECT}.iam.gserviceaccount.com", ""):
            services = cloud()
            services[pre.SERVICE]["spec"]["template"]["spec"]["serviceAccountName"] = account
            self.assert_fails("own production service account", services=services)

    def test_traffic_problems_fail(self):
        for traffic in ([{"revisionName": "a", "percent": 50}, {"revisionName": "b", "percent": 50}], [{"latestRevision": True, "revisionName": "a", "percent": 100}], []):
            services = cloud()
            services[pre.SERVICE]["status"]["traffic"] = traffic
            self.assert_fails("pinned to one revision", services=services)

    def test_private_gateway_or_unreadable_policy_fails(self):
        self.assert_fails("public invoker", policy={"bindings": [{"role": "roles/run.invoker", "members": ["serviceAccount:x@y.iam.gserviceaccount.com"]}]})
        self.assert_fails("public invoker", policy={})
        self.assert_fails("public invoker", read_error={"policy"})

    def test_untrusted_gateway_address_is_never_contacted(self):
        for bad in ("https://prooflab-staging-web-bff-abc123-el.a.run.app", "http://prooflab-web-bff-abc123-el.a.run.app", "https://prooflab-web-bff.evil.example",
                    "https://prooflab-functions-abc123-el.a.run.app", ""):
            services = cloud()
            services[pre.SERVICE]["status"]["url"] = bad
            results, asked, _, _ = self.go(services=services)
            self.assertFalse(results["gateway: reachable at its own production address"], bad)
            self.assertFalse([u for u in asked if u.endswith("/health")], bad)

    def test_services_cannot_be_listed_fails_closed(self):
        results, asked, _, _ = self.go(read_error={"list"})
        self.assertFalse(results["service: production services can be listed"])
        self.assertFalse(results["bridge: production auth-bridge can be inspected"])
        self.assertFalse(results["gateway: reachable at its own production address"])
        self.assertTrue(all(u.startswith(pre.SITE) for u in asked), "only the public site may be contacted")
        self.assertFalse(any(results.values()) and not self.failed(results))

    # ---- configuration ------------------------------------------------------------------------------------

    def test_staging_or_wrong_upstream_fails_and_is_not_contacted(self):
        for bad in ("https://prooflab-staging-functions-abc123-el.a.run.app", "https://prooflab-files-abc123-el.a.run.app", "http://prooflab-functions-abc123-el.a.run.app", ""):
            services = cloud()
            set_env(services[pre.SERVICE], "FUNCTIONS_URL", bad)
            results, asked, text = self.assert_fails("six upstreams", services=services)
            self.assertFalse(results["upstream: prooflab-functions answers its health contract"])
            self.assertNotIn(URL["FUNCTIONS_URL"] + "/ready", asked)
            if bad:
                self.assertNotIn(bad, text)

    def test_staging_database_address_fails(self):
        services = cloud()
        set_env(services[pre.SERVICE], "POSTGREST_URL", "https://prooflab-staging-api-abc123-el.a.run.app")
        results, _, _ = self.assert_fails("six upstreams", services=services)
        self.assertFalse(results["config: no setting points at staging"])

    def test_staging_session_key_or_plain_session_key_fails(self):
        services = cloud()
        env = env_of(services[pre.SERVICE])
        env[:] = [e for e in env if e["name"] != "SESSION_KEY"] + [{"name": "SESSION_KEY", "valueFrom": {"secretKeyRef": {"name": "prooflab-staging-web-bff-session-key", "key": "latest"}}}]
        self.assert_fails("SESSION_KEY", services=services)
        services = cloud()
        set_env(services[pre.SERVICE], "SESSION_KEY", SECRET_VALUE)
        _, _, text = self.assert_fails("SESSION_KEY", services=services)
        self.assertNotIn(SECRET_VALUE, text)

    def test_browser_origin_problems_fail(self):
        for value, word in (("https://prooflab-508214.web.app", "production site is an allowed"), ("https://prooflab.co.in,https://prooflab-staging.web.app", "no staging or local"),
                            ("https://prooflab.co.in,http://localhost:5173", "no staging or local"), ("", "production site is an allowed")):
            services = cloud()
            set_env(services[pre.SERVICE], "BROWSER_ORIGINS", value)
            self.assert_fails(word, services=services)

    # ---- auth-bridge ---------------------------------------------------------------------------------------

    def test_bridge_without_its_own_signing_key_fails(self):
        # Today's production: the bridge still signs with the shared secret.
        services = cloud()
        services[pre.BRIDGE]["spec"]["template"]["spec"]["containers"][0]["env"] = bridge_env(signing=False)
        _, _, text = self.assert_fails("signs with its own key", services=services)
        self.assertIn("/service-token answers 401", text)

    def test_bff_not_a_service_token_caller_or_staging_caller_fails(self):
        services = cloud()
        services[pre.BRIDGE]["spec"]["template"]["spec"]["containers"][0]["env"] = bridge_env(callers=f"prooflab-rt-functions@{pre.PROJECT}.iam.gserviceaccount.com")
        self.assert_fails("is a service-token caller", services=services)
        services = cloud()
        services[pre.BRIDGE]["spec"]["template"]["spec"]["containers"][0]["env"] = bridge_env(callers=f"{BFF_ACCOUNT},prooflab-staging-web-bff@{pre.PROJECT}.iam.gserviceaccount.com")
        self.assert_fails("no staging identity", services=services)

    def test_missing_bridge_fails(self):
        services = cloud()
        del services[pre.BRIDGE]
        self.assert_fails("auth-bridge can be inspected", services=services)

    # ---- other answers ------------------------------------------------------------------------------------

    def test_each_wrong_answer_fails_its_own_check(self):
        cases = [
            (f"{BFF_URL}/health", (200, JSON, {"ok": True, "service": "prooflab-staging-web-bff"})),
            (f"{BFF_URL}/health", (404, "text/html", b"<html>Google 404</html>")),
            (f"{BFF_URL}/api/auth/session", (200, JSON, {"session": {"user": {}}})),
            (f"{BFF_URL}{pre.PROTECTED[0]}", (200, JSON, [])),
            (f"{BFF_URL}{pre.PROTECTED[1]}", (403, JSON, {"error": "forbidden"})),
            (f"{pre.SITE}{pre.PROTECTED[0]}", (401, "text/html", b"<html>")),
            (URL["FUNCTIONS_URL"] + "/ready", (503, "application/json", {"ok": False})),
            (URL["FILES_URL"] + "/", (200, "application/json", {"ok": True})),
            (URL["TRANSCRIBER_URL"] + "/ready", TimeoutError("timed out")),
            (f"{BFF_URL}/health", OSError("connection refused")),
        ]
        for url, reply in cases:
            answers = web()
            self.assertIn(url, answers)
            answers[url] = reply
            results, _, _, _ = self.go(answers=answers)
            self.assertEqual(len(self.failed(results)), 1, f"{url} -> {reply!r}: {self.failed(results)}")

    def test_no_value_is_reported(self):
        _, _, text, _ = self.go()
        for hidden in (SECRET_VALUE, *URL.values(), BFF_ACCOUNT, "prooflab-508214.web.app"):
            self.assertNotIn(hidden, text)

    # ---- the tool itself ------------------------------------------------------------------------------------

    def test_the_target_is_fixed_and_is_production(self):
        self.assertEqual((pre.PROJECT, pre.REGION, pre.SERVICE, pre.SITE), ("prooflab-508214", "asia-south1", "prooflab-web-bff", "https://prooflab.co.in"))
        self.assertNotIn("staging", pre.SERVICE + pre.SITE + pre.BRIDGE + "".join(s[0] for s in pre.UPSTREAMS.values()))
        with mock.patch.object(pre, "run", side_effect=AssertionError("must not run")), mock.patch("builtins.print"):
            for argv in (["--service", "prooflab-staging-web-bff"], ["--site", "https://prooflab-staging.web.app"], ["anything"]):
                self.assertEqual(pre.main(argv), 2)

    def test_only_two_read_commands_exist(self):
        self.assertEqual(pre.gcloud_argv("gcloud", "list")[1:4], ["run", "services", "list"])
        self.assertEqual(pre.gcloud_argv("gcloud", "policy")[1:5], ["run", "services", "get-iam-policy", pre.SERVICE])
        for what in ("list", "policy"):
            self.assertIn(f"--project={pre.PROJECT}", pre.gcloud_argv("gcloud", what))
        with self.assertRaises(KeyError):
            pre.gcloud_argv("gcloud", "deploy")

    def test_source_has_no_way_to_change_anything(self):
        code = Path(pre.__file__).read_text(encoding="utf-8").split('"""', 2)[2]
        for forbidden in ("deploy", "update-traffic", "set-iam", "add-iam", "secrets", "print-access-token", "identitytoolkit", "signInWithPassword",
                          "/api/auth/login", '"POST"', '"PUT"', '"PATCH"', '"DELETE"', "os.system", "shell=True", "Authorization", "argparse"):
            self.assertNotIn(forbidden, code, f"'{forbidden}' has no place in a read-only preflight")
        self.assertEqual(code.count("subprocess.run("), 1)
        self.assertEqual(code.count('method="GET"'), 1)

    def test_http_get_is_anonymous_bounded_and_follows_no_redirect(self):
        seen = {}

        class Reply:
            status = 200
            headers = {"Content-Type": JSON}

            def read(self, limit):
                seen["limit"] = limit
                return b"{}"

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        class Opener:
            def open(self, request, timeout=None):
                seen.update(method=request.get_method(), timeout=timeout, headers={k.lower() for k in request.headers})
                return Reply()

        with mock.patch.object(pre.urllib.request, "build_opener", lambda *handlers: seen.update(handlers=handlers) or Opener()):
            self.assertEqual(pre.http_get(f"{BFF_URL}/health"), (200, JSON, b"{}"))
        self.assertEqual((seen["method"], seen["timeout"], seen["limit"]), ("GET", pre.TIMEOUT, pre.MAX_BODY))
        self.assertEqual(seen["headers"] & {"authorization", "cookie"}, set())
        self.assertEqual(seen["handlers"], (pre._NoRedirect,))
        self.assertIsNone(pre._NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://evil.example"))

    def test_exit_code_is_0_only_when_every_check_passed(self):
        with mock.patch("builtins.print"):
            with mock.patch.object(pre, "run", return_value=[(True, "a", "")]):
                self.assertEqual(pre.main([]), 0)
            with mock.patch.object(pre, "run", return_value=[(True, "a", ""), (False, "b", "")]):
                self.assertEqual(pre.main([]), 1)


if __name__ == "__main__":
    unittest.main()
