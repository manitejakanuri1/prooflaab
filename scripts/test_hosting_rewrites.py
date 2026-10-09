"""Hosting must send /api/** to the gateway, and to the right one. No network."""
import ast
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hosting_rewrites  # noqa: E402
import release_guard as guard  # noqa: E402

DEPLOY = Path(__file__).resolve().parent / "deploy-hosting.py"


class HostingRewriteTests(unittest.TestCase):
    def test_api_goes_to_the_gateway_before_the_page_catch_all(self):
        found = hosting_rewrites.rewrites("prooflab-staging-web-bff", "asia-south1")
        self.assertEqual(found, [
            {"glob": "/api/**", "run": {"serviceId": "prooflab-staging-web-bff", "region": "asia-south1"}},
            {"glob": "**", "path": "/index.html"},
        ])

    def test_only_api_is_sent_to_the_gateway(self):
        for service in ("prooflab-staging-web-bff", "prooflab-web-bff"):
            found = hosting_rewrites.rewrites(service, "asia-south1")
            to_run = [r for r in found if "run" in r]
            self.assertEqual([r["glob"] for r in to_run], ["/api/**"])
            self.assertEqual(found[-1], {"glob": "**", "path": "/index.html"}, "the page catch-all must stay last")
            self.assertNotIn("tag", to_run[0]["run"], "Hosting follows the service's live traffic, never a pinned tag")

    def test_no_gateway_means_no_api_route_and_the_guard_refuses_that_publish(self):
        self.assertEqual(hosting_rewrites.rewrites("", "asia-south1"), [{"glob": "**", "path": "/index.html"}])
        with tempfile.TemporaryDirectory() as dist:
            Path(dist, "index.html").write_text("<html></html>", encoding="utf-8")
            for site in ("prooflab-staging", "prooflab-508214"):
                found = guard.problems(site, {}, dist, health=lambda url: {}, commit="a" * 40)
                self.assertTrue(any("BFF_SERVICE is not set" in line for line in found), site)

    def test_the_deploy_script_uses_this_list_and_checks_the_guard_first(self):
        source = DEPLOY.read_text(encoding="utf-8")
        tree = ast.parse(source)

        calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
        used = [n for n in calls if n.func.attr == "rewrites" and getattr(n.func.value, "id", "") == "hosting_rewrites"]
        self.assertEqual(len(used), 1, "deploy-hosting.py must build its rewrites with hosting_rewrites.rewrites")
        self.assertEqual([getattr(a, "id", "") for a in used[0].args], ["BFF_SERVICE", "BFF_REGION"])

        # No second, hand-written rewrite list may come back beside it.
        self.assertNotIn('"glob": "/api/**"', source)

        guard_line = next(n.lineno for n in calls if n.func.attr == "enforce")
        first_upload = min(
            n.lineno for n in ast.walk(tree)
            if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "call" and not isinstance(n, ast.FunctionDef)
        )
        self.assertLess(guard_line, first_upload, "the release guard must run before anything is sent")


if __name__ == "__main__":
    unittest.main(verbosity=2)
