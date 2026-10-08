"""The staging BFF preflight is read-only and fails closed. No network, no gcloud: everything is faked."""
import copy
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import staging_bff_preflight as pre  # noqa: E402

SERVICE_URL = "https://prooflab-staging-web-bff-ysn2mpe6sa-el.a.run.app"
CANARY_URL = "https://s23---prooflab-staging-web-bff-ysn2mpe6sa-el.a.run.app"
UP = {name: f"https://{pre.UPSTREAM_HOST_PREFIXES[name]}ysn2mpe6sa-el.a.run.app"
      for name in (*pre.UPSTREAMS, *pre.UPSTREAM_SHAPE_ONLY)}
SECRET_VALUE = "TEST-ONLY-NOT-A-REAL-VALUE-0123456789"


def service():
    env = [{"name": name, "value": url} for name, url in UP.items()]
    env += [
        {"name": "BROWSER_ORIGINS", "value": "https://prooflab-staging.web.app,https://prooflab-staging.firebaseapp.com"},
        {"name": "GOOGLE_API_KEY", "value": SECRET_VALUE},
        {"name": "SESSION_KEY", "valueFrom": {"secretKeyRef": {"name": "prooflab-staging-web-bff-session-key", "key": "latest"}}},
    ]
    return {
        "metadata": {"name": pre.SERVICE, "labels": {"cloud.googleapis.com/location": pre.REGION}},
        "spec": {"template": {"spec": {
            "serviceAccountName": f"{pre.SERVICE}@{pre.PROJECT}.iam.gserviceaccount.com",
            "containers": [{"image": "example/prooflab-web-bff:stab-13771d2", "env": env}],
        }}},
        "status": {
            "url": SERVICE_URL,
            "latestCreatedRevisionName": pre.CANARY_REVISION,
            "latestReadyRevisionName": pre.CANARY_REVISION,
            "traffic": [
                {"revisionName": pre.STABLE_REVISION, "percent": 100},
                {"revisionName": pre.CANARY_REVISION, "tag": pre.TAG, "url": CANARY_URL},
            ],
        },
    }


JSON = "application/json; charset=utf-8"
CLOSED = (503, JSON, {"ok": False, "service": "prooflab-web-bff", "state": "security-migration-in-progress"})
REFUSED = (401, JSON, {"error": "not authenticated"})
NO_SESSION = (200, JSON, {"session": None})


def answers():
    out = {
        f"{CANARY_URL}/health": (200, JSON, {"ok": True, "service": "prooflab-web-bff"}),
        f"{CANARY_URL}/ready": CLOSED,
        f"{CANARY_URL}/api/auth/session": NO_SESSION,
        f"{CANARY_URL}/preflight-unknown-path": (404, JSON, {"error": "not found"}),
        f"{SERVICE_URL}/api/auth/session": NO_SESSION,
        f"{SERVICE_URL}/ready": CLOSED,
        f"{pre.SITE}/api/auth/session": NO_SESSION,
        f"{pre.SITE}{pre.PROTECTED[0]}": REFUSED,
    }
    for path in pre.PROTECTED:
        out[f"{CANARY_URL}{path}"] = REFUSED
    for name, (path, code, field, value) in pre.UPSTREAMS.items():
        out[UP[name] + path] = (code, "application/json", {field: value})
    return out


class Preflight(unittest.TestCase):
    def go(self, svc=None, web=None, argv=()):
        """Run with fakes. Returns (results by name, list of URLs contacted, printed text)."""
        args = self.args(argv)
        svc = service() if svc is None else svc
        web = answers() if web is None else web
        asked = []

        def describe(project, region, name):
            self.assertEqual((project, region, name), (args.project, args.region, args.service))
            if isinstance(svc, Exception):
                raise svc
            return svc

        def http(url, timeout):
            asked.append(url)
            self.assertTrue(timeout and timeout > 0, "every call must have a timeout")
            reply = web.get(url)
            if reply is None:
                raise AssertionError(f"unexpected call to {url}")
            if isinstance(reply, Exception):
                raise reply
            code, ctype, body = reply
            return code, ctype, body if isinstance(body, bytes) else json.dumps(body).encode()

        results = pre.run(args, describe=describe, http=http)
        text = "\n".join(f"{ok} {name} {detail}" for ok, name, detail in results)
        return {name: ok for ok, name, _ in results}, asked, text

    @staticmethod
    def args(argv=()):
        import argparse
        base = dict(project=pre.PROJECT, region=pre.REGION, service=pre.SERVICE, site=pre.SITE, tag=pre.TAG,
                    canary_revision=pre.CANARY_REVISION, stable_revision=pre.STABLE_REVISION)
        base.update(dict(argv))
        return argparse.Namespace(**base)

    def failed(self, results):
        return sorted(name for name, ok in results.items() if not ok)

    def assert_fails(self, word, **kw):
        results, asked, text = self.go(**kw)
        hit = [name for name in self.failed(results) if word in name]
        self.assertTrue(hit, f"expected a failed check mentioning '{word}', failed: {self.failed(results)}")
        return results, asked, text

    # ---- the good case ---------------------------------------------------------------------------

    def test_everything_as_expected_passes(self):
        results, asked, _ = self.go()
        self.assertEqual(self.failed(results), [])
        self.assertGreaterEqual(len(results), 25)
        self.assertEqual(sorted(asked), sorted(answers()), "exactly the documented endpoints are contacted, once each")

    def test_only_staging_addresses_and_the_staging_site_are_ever_contacted(self):
        _, asked, _ = self.go()
        for url in asked:
            self.assertTrue(url.startswith("https://"), url)
            self.assertIn("staging", url)

    # ---- nothing secret is reported --------------------------------------------------------------

    def test_no_configuration_value_or_response_body_is_reported(self):
        web = answers()
        web[f"{CANARY_URL}/health"] = (200, JSON, {"ok": False, "leak": "BODY-MUST-NOT-APPEAR"})
        web[f"{pre.SITE}/api/auth/session"] = (200, "text/html", b"<html>BODY-MUST-NOT-APPEAR</html>")
        _, _, text = self.go(web=web)
        for hidden in (SECRET_VALUE, "BODY-MUST-NOT-APPEAR", *UP.values(), "firebaseapp.com"):
            self.assertNotIn(hidden, text)

    # ---- identity ----------------------------------------------------------------------------------

    def test_wrong_service_region_or_identity_fails(self):
        for word, change in (
            ("service name", lambda s: s["metadata"].update(name="prooflab-web-bff")),
            ("region", lambda s: s["metadata"]["labels"].update({"cloud.googleapis.com/location": "us-central1"})),
            ("service account", lambda s: s["spec"]["template"]["spec"].update(serviceAccountName="135298577404-compute@developer.gserviceaccount.com")),
            ("service account", lambda s: s["spec"]["template"]["spec"].update(serviceAccountName=f"{pre.SERVICE}@another-project.iam.gserviceaccount.com")),
        ):
            svc = service()
            change(svc)
            self.assert_fails(word, svc=svc)

    def test_describe_failure_fails_closed_and_contacts_nothing(self):
        results, asked, _ = self.go(svc=RuntimeError("gcloud could not describe the service"))
        self.assertEqual(self.failed(results), ["identity: service can be described"])
        self.assertEqual(asked, [])

    # ---- traffic ----------------------------------------------------------------------------------

    def test_canary_taking_traffic_fails(self):
        svc = service()
        svc["status"]["traffic"] = [
            {"revisionName": pre.STABLE_REVISION, "percent": 90},
            {"revisionName": pre.CANARY_REVISION, "tag": pre.TAG, "percent": 10, "url": CANARY_URL},
        ]
        results, _, _ = self.assert_fails("takes 0%", svc=svc)
        self.assertFalse(results["traffic: stable revision takes 100% of normal traffic"])

    def test_promoted_canary_fails(self):
        svc = service()
        svc["status"]["traffic"] = [
            {"revisionName": pre.CANARY_REVISION, "percent": 100},
            {"revisionName": pre.CANARY_REVISION, "tag": pre.TAG, "url": CANARY_URL},
        ]
        self.assert_fails("stable revision takes 100%", svc=svc)

    def test_a_third_revision_with_traffic_fails(self):
        svc = service()
        svc["status"]["traffic"][0]["percent"] = 100
        svc["status"]["traffic"].append({"revisionName": "prooflab-staging-web-bff-00003-j7r", "percent": 1})
        self.assert_fails("stable revision takes 100%", svc=svc)

    def test_traffic_following_latest_fails(self):
        svc = service()
        svc["status"]["traffic"][0]["latestRevision"] = True
        self.assert_fails("pinned", svc=svc)

    def test_tag_on_another_revision_or_missing_fails(self):
        svc = service()
        svc["status"]["traffic"][1]["revisionName"] = "prooflab-staging-web-bff-00006-new"
        self.assert_fails("expected canary revision", svc=svc)
        svc = service()
        del svc["status"]["traffic"][1]
        results, asked, _ = self.assert_fails("expected canary revision", svc=svc)
        self.assertFalse(results["canary: reachable at its tagged address"])
        self.assertFalse(any("s23---" in url for url in asked))

    def test_a_newer_revision_than_the_canary_fails(self):
        svc = service()
        svc["status"]["latestCreatedRevisionName"] = "prooflab-staging-web-bff-00006-new"
        self.assert_fails("newest revision", svc=svc)

    def test_canary_address_that_is_not_the_tagged_staging_address_is_never_contacted(self):
        for bad in ("https://evil.example", "http://s23---prooflab-staging-web-bff-ysn2mpe6sa-el.a.run.app",
                    "https://s23---prooflab-web-bff-ysn2mpe6sa-el.a.run.app", "https://prooflab-staging-other-ysn2mpe6sa-el.a.run.app",
                    "https://s23---prooflab-staging-other-ysn2mpe6sa-el.a.run.app"):
            svc = service()
            svc["status"]["traffic"][1]["url"] = bad
            results, asked, _ = self.go(svc=svc)
            self.assertFalse(results["routing: canary address is the tagged address of this service"], bad)
            self.assertFalse(results["canary: reachable at its tagged address"], bad)
            self.assertFalse([name for name in results if name.startswith("canary: /")], "no canary probe may run")
            for path in ("/health", "/ready", "/api/auth/session", "/preflight-unknown-path", *pre.PROTECTED):
                self.assertNotIn(bad + path, asked)

    def test_service_address_that_is_not_this_service_is_never_contacted(self):
        svc = service()
        svc["status"]["url"] = "https://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app"
        results, asked, _ = self.go(svc=svc)
        self.assertFalse(results["routing: service address is this staging service"])
        self.assertFalse(results["stable: reachable at the service address"])
        self.assertNotIn("https://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app/api/auth/session", asked)

    # ---- configuration -----------------------------------------------------------------------------

    def test_release_switch_on_fails(self):
        svc = service()
        svc["spec"]["template"]["spec"]["containers"][0]["env"].append({"name": "BFF_RELEASE_READY", "value": "true"})
        self.assert_fails("release switch", svc=svc)

    def test_plain_session_key_fails(self):
        svc = service()
        env = svc["spec"]["template"]["spec"]["containers"][0]["env"]
        env[:] = [e for e in env if e["name"] != "SESSION_KEY"] + [{"name": "SESSION_KEY", "value": SECRET_VALUE}]
        self.assert_fails("SESSION_KEY", svc=svc)

    def test_production_or_insecure_upstream_fails_and_is_not_contacted(self):
        for bad in ("https://prooflab-functions-ysn2mpe6sa-el.a.run.app", "http://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app",
                    "https://prooflab-staging-functions.evil.example", "https://user@prooflab-staging-functions-ysn2mpe6sa-el.a.run.app", ""):
            svc = service()
            for e in svc["spec"]["template"]["spec"]["containers"][0]["env"]:
                if e["name"] == "FUNCTIONS_URL":
                    e["value"] = bad
            results, asked, _ = self.assert_fails("every upstream is a staging", svc=svc)
            self.assertFalse(results["upstream: functions answers its health contract"])
            self.assertFalse(any("functions" in url for url in asked), bad)

    def test_production_database_address_fails(self):
        svc = service()
        for e in svc["spec"]["template"]["spec"]["containers"][0]["env"]:
            if e["name"] == "POSTGREST_URL":
                e["value"] = "https://prooflab-api-ysn2mpe6sa-el.a.run.app"
        self.assert_fails("every upstream is a staging", svc=svc)

    def test_site_not_an_allowed_origin_or_http_origin_fails(self):
        svc = service()
        for e in svc["spec"]["template"]["spec"]["containers"][0]["env"]:
            if e["name"] == "BROWSER_ORIGINS":
                e["value"] = "https://prooflab.co.in"
        self.assert_fails("allowed browser origin", svc=svc)
        svc = service()
        for e in svc["spec"]["template"]["spec"]["containers"][0]["env"]:
            if e["name"] == "BROWSER_ORIGINS":
                e["value"] += ",http://localhost:5173"
        self.assert_fails("plain http", svc=svc)

    # ---- answers -----------------------------------------------------------------------------------

    def test_each_wrong_answer_fails_its_own_check(self):
        html = (200, "text/html; charset=utf-8", b"<!doctype html><title>ProofLab</title>")
        cases = [
            (f"{CANARY_URL}/health", (404, "text/html", b"<html>Google 404</html>"), "canary: /health"),
            (f"{CANARY_URL}/health", (200, JSON, {"ok": True, "service": "something-else"}), "canary: /health"),
            (f"{CANARY_URL}/health", (200, JSON, {"ok": True, "service": "prooflab-web-bff", "extra": 1}), "canary: /health"),
            (f"{CANARY_URL}/ready", (200, JSON, {"ok": True, "service": "prooflab-web-bff", "state": "ready"}), "canary: /ready"),
            (f"{CANARY_URL}/ready", (503, "text/html", b"Service Unavailable"), "canary: /ready"),
            (f"{CANARY_URL}/api/auth/session", (200, JSON, {"session": {"user": {"id": "x"}}}), "canary: anonymous /api/auth/session"),
            (f"{CANARY_URL}/api/auth/session", (200, JSON, {}), "canary: anonymous /api/auth/session"),
            (f"{CANARY_URL}/api/auth/session", (503, JSON, {"error": "session service unavailable"}), "canary: anonymous /api/auth/session"),
            (f"{CANARY_URL}{pre.PROTECTED[0]}", (200, JSON, []), f"canary: anonymous {pre.PROTECTED[0]}"),
            (f"{CANARY_URL}{pre.PROTECTED[1]}", (403, JSON, {"error": "forbidden"}), f"canary: anonymous {pre.PROTECTED[1]}"),
            (f"{CANARY_URL}{pre.PROTECTED[0]}", (401, "text/html", b"<html>"), f"canary: anonymous {pre.PROTECTED[0]}"),
            (f"{CANARY_URL}/preflight-unknown-path", html, "canary: an unknown path"),
            (f"{SERVICE_URL}/api/auth/session", (500, JSON, {"error": "x"}), "stable: anonymous /api/auth/session"),
            (f"{SERVICE_URL}/ready", (200, JSON, {"ok": True, "service": "prooflab-web-bff"}), "stable: /ready"),
            (f"{pre.SITE}/api/auth/session", html, "site: /api/auth/session"),
            (f"{pre.SITE}{pre.PROTECTED[0]}", html, f"site: anonymous {pre.PROTECTED[0]}"),
            (UP["FUNCTIONS_URL"] + "/ready", (503, "application/json", {"ok": False}), "upstream: functions"),
            (UP["AUTH_BRIDGE_URL"] + "/ready", (200, "application/json", {"ok": "true"}), "upstream: auth-bridge"),
            (UP["FILES_URL"] + "/", (200, "application/json", {"ok": True}), "upstream: files"),
            (UP["TRANSCRIBER_URL"] + "/ready", TimeoutError("timed out"), "upstream: transcriber"),
            (UP["ACCOUNTS_URL"] + "/ready", (200, "application/json", b"{not json"), "upstream: accounts"),
            (f"{CANARY_URL}/health", OSError("connection refused"), "canary: /health"),
        ]
        for url, reply, word in cases:
            web = answers()
            self.assertIn(url, web)
            web[url] = reply
            results, _, _ = self.go(web=web)
            self.assertEqual(self.failed(results), [name for name in results if name.startswith(word)], f"{url} -> {reply!r}")
            self.assertEqual(len(self.failed(results)), 1, url)

    # ---- the tool itself is read-only ------------------------------------------------------------

    def test_the_only_command_is_describe(self):
        argv = pre.describe_argv("gcloud", pre.PROJECT, pre.REGION, pre.SERVICE)
        self.assertEqual(argv[1:5], ["run", "services", "describe", pre.SERVICE])
        self.assertEqual(sorted(argv[5:]), sorted([f"--project={pre.PROJECT}", f"--region={pre.REGION}", "--format=json"]))

    def test_source_has_no_way_to_change_anything(self):
        source = Path(pre.__file__).read_text(encoding="utf-8")
        code = source.split('"""', 2)[2]      # the module text after its description
        for forbidden in ("deploy", "update-traffic", "set-iam", "add-iam", "secrets", "print-access-token", "identitytoolkit",
                          "signInWithPassword", "/api/auth/login", '"POST"', '"PUT"', '"PATCH"', '"DELETE"', "os.system", "shell=True", "Authorization"):
            self.assertNotIn(forbidden, code, f"'{forbidden}' has no place in a read-only preflight")
        self.assertEqual(code.count("subprocess.run("), 1, "exactly one command: the describe")
        self.assertEqual(code.count('method="GET"'), 1)

    def test_http_get_sends_an_anonymous_get_with_a_timeout_and_reads_a_bounded_body(self):
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
            self.assertEqual(pre.http_get("https://prooflab-staging-x.a.run.app/health"), (200, JSON, b"{}"))
        self.assertEqual(seen["method"], "GET")
        self.assertEqual(seen["timeout"], pre.TIMEOUT)
        self.assertEqual(seen["limit"], pre.MAX_BODY)
        self.assertEqual(seen["headers"] & {"authorization", "cookie"}, set())
        self.assertEqual(seen["handlers"], (pre._NoRedirect,), "redirects must not be followed")
        self.assertIsNone(pre._NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://evil.example"))

    # ---- refusing to run against the wrong target ----------------------------------------------

    def test_untrusted_staging_lookalikes_are_refused(self):
        for change in (
            {"site": "https://staging.attacker.example"},
            {"site": "https://prooflab-staging.web.app.evil.example"},
            {"site": "https://prooflab-staging.firebaseapp.com"},
            {"service": "evil-prooflab-staging-web-bff", "canary_revision": "evil-prooflab-staging-web-bff-00005-wuh", "stable_revision": "evil-prooflab-staging-web-bff-00004-9nn"},
        ):
            self.assertTrue(pre.refuse_unsafe_target(self.args(change.items())), change)

    def test_wrong_staging_secret_is_rejected(self):
        svc = service()
        for e in svc["spec"]["template"]["spec"]["containers"][0]["env"]:
            if e["name"] == "SESSION_KEY":
                e["valueFrom"]["secretKeyRef"]["name"] = "prooflab-production-session-key"
        self.assert_fails("correct staging secret", svc=svc)

    def test_other_cloud_run_project_is_never_contacted(self):
        svc = service()
        for e in svc["spec"]["template"]["spec"]["containers"][0]["env"]:
            if e["name"] == "FUNCTIONS_URL":
                e["value"] = "https://prooflab-staging-functions-someother-el.a.run.app"
        results, asked, _ = self.go(svc=svc)
        self.assertFalse(results["config: every upstream is a staging https run.app address"])
        self.assertFalse(any("someother" in u for u in asked))

    def test_wrong_upstream_service_or_unapproved_origin_is_rejected(self):
        svc = service()
        for e in svc["spec"]["template"]["spec"]["containers"][0]["env"]:
            if e["name"] == "POSTGREST_URL":
                e["value"] = "https://prooflab-staging-rogue-db-ysn2mpe6sa-el.a.run.app"
            if e["name"] == "BROWSER_ORIGINS":
                e["value"] += ",https://staging.attacker.example"
        results, asked, _ = self.go(svc=svc)
        self.assertFalse(results["config: every upstream is a staging https run.app address"])
        self.assertFalse(results["config: all allowed browser origins are approved staging sites"])
        self.assertFalse(any("rogue" in u for u in asked))

    def test_wrong_identity_aborts_before_http(self):
        svc = service()
        svc["metadata"]["name"] = "unexpected-staging-service"
        results, asked, _ = self.go(svc=svc)
        self.assertFalse(results["identity: service name"])
        self.assertEqual(asked, [])

    def test_production_or_malformed_targets_are_refused_before_anything_is_contacted(self):
        bad = [
            {"service": "prooflab-web-bff", "canary_revision": "prooflab-web-bff-00001-aaa", "stable_revision": "prooflab-web-bff-00002-bbb"},
            {"project": "another-project"},
            {"region": "us-central1"},
            {"site": "https://prooflab.co.in"},
            {"site": "http://prooflab-staging.web.app"},
            {"site": "https://prooflab-staging.web.app/some/path"},
            {"canary_revision": "prooflab-web-bff-00005-wuh"},
            {"stable_revision": pre.CANARY_REVISION},
        ]
        for change in bad:
            self.assertTrue(pre.refuse_unsafe_target(self.args(change.items())), change)
        self.assertEqual(pre.refuse_unsafe_target(self.args()), [])

    def test_command_line_refusal_exits_2_and_runs_nothing(self):
        with mock.patch.object(pre, "run", side_effect=AssertionError("must not run")), mock.patch("builtins.print"):
            self.assertEqual(pre.main(["--service", "prooflab-web-bff"]), 2)

    def test_exit_code_is_0_only_when_every_check_passed(self):
        with mock.patch("builtins.print"):
            with mock.patch.object(pre, "run", return_value=[(True, "a", ""), (True, "b", "")]):
                self.assertEqual(pre.main([]), 0)
            with mock.patch.object(pre, "run", return_value=[(True, "a", ""), (False, "b", "why")]):
                self.assertEqual(pre.main([]), 1)

    def test_fixture_is_not_mutated_between_cases(self):
        self.assertEqual(service(), copy.deepcopy(service()))


if __name__ == "__main__":
    unittest.main()
