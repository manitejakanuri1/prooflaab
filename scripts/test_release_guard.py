"""The publish guard refuses unless production routing AND the owner's approval are in place. No network."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release_guard as guard  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
COMMIT = "a" * 40
OK_HEALTH = lambda url: {"ok": True, "service": "prooflab-web-bff"}  # noqa: E731
GOOD = {
    "BFF_SERVICE": "prooflab-web-bff",
    "PRODUCTION_RELEASE_APPROVED_SHA": COMMIT,
    "BFF_HEALTH_URL": "https://prooflab-web-bff-abc123-el.a.run.app",
}


class ReleaseGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dist = self.tmp.name
        Path(self.dist, "index.html").write_text('<script type="module" src="/assets/index-1.js"></script>', encoding="utf-8")
        os.mkdir(os.path.join(self.dist, "assets"))
        Path(self.dist, "assets", "index-1.js").write_text('fetch("/api/auth/session")', encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def check(self, env, site="prooflab-508214", health=OK_HEALTH, commit=COMMIT):
        return guard.problems(site, env, self.dist, health=health, commit=commit)

    def refused(self, env, word, **kw):
        found = self.check(env, **kw)
        self.assertTrue(any(word in line for line in found), f"expected a refusal mentioning '{word}', got {found}")

    def test_everything_in_place_is_allowed(self):
        self.assertEqual(self.check(GOOD), [])
        self.assertEqual(self.check(GOOD, site=""), [], "an unset site is the production site")

    def test_nothing_set_is_refused(self):
        found = self.check({})
        self.assertGreaterEqual(len(found), 3, found)
        self.refused({}, "BFF_SERVICE is not set")
        self.refused({}, "has not approved")
        self.refused({}, "BFF_HEALTH_URL is not set")

    def test_missing_gateway_route_is_refused(self):
        self.refused({**GOOD, "BFF_SERVICE": ""}, "nobody could sign in")
        self.refused({**GOOD, "BFF_SERVICE": "   "}, "nobody could sign in")

    def test_production_never_routes_to_another_service(self):
        self.refused({**GOOD, "BFF_SERVICE": "prooflab-staging-web-bff"}, "production must route")
        self.refused({**GOOD, "BFF_SERVICE": "prooflab-functions"}, "production must route")
        self.refused({**GOOD, "BFF_REGION": "us-central1"}, "BFF_REGION")

    def test_approval_must_be_for_this_exact_commit(self):
        self.refused({**GOOD, "PRODUCTION_RELEASE_APPROVED_SHA": ""}, "has not approved")
        self.refused({**GOOD, "PRODUCTION_RELEASE_APPROVED_SHA": "b" * 40}, "approve this commit first")
        self.refused({**GOOD, "PRODUCTION_RELEASE_APPROVED_SHA": "aaaaaaa"}, "full 40-character")
        self.refused({**GOOD, "PRODUCTION_RELEASE_APPROVED_SHA": "yes"}, "full 40-character")
        self.refused({**GOOD, "PRODUCTION_RELEASE_APPROVED_SHA": "true"}, "full 40-character")
        self.refused(GOOD, "which commit", commit="")
        self.assertEqual(self.check({**GOOD, "PRODUCTION_RELEASE_APPROVED_SHA": COMMIT.upper()}), [], "case does not matter")

    def test_gateway_must_exist_and_answer(self):
        def down(url):
            raise OSError("connection refused")

        self.refused(GOOD, "not reachable", health=down)
        self.refused(GOOD, "did not answer", health=lambda url: {"ok": False, "service": "prooflab-web-bff"})
        self.refused(GOOD, "did not answer", health=lambda url: {"ok": True, "service": "something-else"})
        self.refused(GOOD, "did not answer", health=lambda url: "ok")
        self.refused({**GOOD, "BFF_HEALTH_URL": ""}, "BFF_HEALTH_URL is not set")
        self.refused({**GOOD, "BFF_HEALTH_URL": "http://prooflab-web-bff-abc-el.a.run.app"}, "https://...run.app")
        self.refused({**GOOD, "BFF_HEALTH_URL": "https://evil.example/"}, "https://...run.app")
        self.refused({**GOOD, "BFF_HEALTH_URL": "https://prooflab-staging-web-bff-abc-el.a.run.app"}, "staging service")

    def test_gateway_is_not_asked_when_the_address_is_wrong(self):
        asked = []
        self.check({**GOOD, "BFF_HEALTH_URL": "https://evil.example/"}, health=lambda url: asked.append(url) or {})
        self.assertEqual(asked, [], "an untrusted address must never be contacted")

    def test_staging_build_is_not_published_to_production(self):
        Path(self.dist, "assets", "index-1.js").write_text('const api="https://prooflab-staging-api-x.a.run.app"', encoding="utf-8")
        self.refused(GOOD, "staging build")

    def test_no_build_is_refused(self):
        os.remove(os.path.join(self.dist, "index.html"))
        self.refused(GOOD, "no build to publish")

    def test_staging_site_needs_a_staging_gateway_and_no_approval(self):
        self.assertEqual(self.check({"BFF_SERVICE": "prooflab-staging-web-bff"}, site="prooflab-staging"), [])
        self.refused({}, "BFF_SERVICE is not set", site="prooflab-staging")
        self.refused({"BFF_SERVICE": "prooflab-web-bff"}, "staging gateway", site="prooflab-staging")

    def test_unknown_site_is_refused(self):
        self.refused(GOOD, "unknown Hosting site", site="some-other-site")

    def test_command_line_exits_1_and_uploads_nothing_when_refused(self):
        env = {k: v for k, v in os.environ.items() if k not in ("BFF_SERVICE", "PRODUCTION_RELEASE_APPROVED_SHA", "BFF_HEALTH_URL", "HOSTING_SITE", "BFF_REGION")}
        run = subprocess.run([sys.executable, str(ROOT / "scripts" / "release_guard.py"), self.dist], capture_output=True, text=True, env=env)
        self.assertEqual(run.returncode, 1, run.stderr)
        self.assertIn("publish refused", run.stderr)

    def test_publish_script_calls_the_guard_before_any_upload(self):
        text = (ROOT / "scripts" / "deploy-hosting.py").read_text(encoding="utf-8")
        self.assertIn("release_guard.enforce(", text)
        self.assertLess(text.index("release_guard.enforce("), text.index("def find_gcloud"), "the guard must run before gcloud is even looked for")
        self.assertLess(text.index("release_guard.enforce("), text.index('call("POST"'), "the guard must run before the first upload call")

    def test_workflow_gives_the_publish_step_only_owner_set_values(self):
        text = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")
        publish = text[text.index("- name: Publish"):]
        for needed in ("vars.PRODUCTION_BFF_SERVICE", "vars.PRODUCTION_RELEASE_APPROVED_SHA", "vars.PRODUCTION_BFF_HEALTH_URL"):
            self.assertIn(needed, publish)
        self.assertNotIn("github.sha }}\n          PRODUCTION_RELEASE_APPROVED_SHA", publish)
        self.assertNotRegex(publish, r"PRODUCTION_RELEASE_APPROVED_SHA:\s*\$\{\{\s*github\.sha", "the workflow must not approve itself")
        self.assertIn("scripts/release_guard.py", text[:text.index("- name: Publish")], "a guard step must come before Publish")


if __name__ == "__main__":
    unittest.main()
