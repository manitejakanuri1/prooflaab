"""The staging rollback plan prints staging commands only, and runs nothing. No network."""
import contextlib
import io
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import staging_rollback_plan as rollback  # noqa: E402

GOOD_REVISION = "prooflab-staging-web-bff-00004-9nn"
GOOD_VERSION = "939a668ef6990b38"


class StagingRollbackPlanTests(unittest.TestCase):
    def test_the_plan_is_gateway_first_then_site_and_staging_only(self):
        steps = rollback.plan(GOOD_REVISION, GOOD_VERSION)
        commands = [command for _title, command in steps]

        self.assertIn("update-traffic prooflab-staging-web-bff", commands[0])
        self.assertIn(f"--to-revisions {GOOD_REVISION}=100", commands[0])
        self.assertIn("--region asia-south1", commands[0])
        self.assertIn(f"sites/prooflab-staging/releases?versionName=sites/prooflab-staging/versions/{GOOD_VERSION}", commands[2])
        self.assertLess(
            next(i for i, c in enumerate(commands) if "update-traffic" in c),
            next(i for i, c in enumerate(commands) if "/releases?" in c),
            "the gateway goes back before the site",
        )

        for command in commands:
            self.assertNotIn("sites/prooflab-508214", command, "the production site must never appear")
            self.assertNotIn("prooflab-web-bff", command, "the production gateway must never appear")
            for word in ("delete", "--to-latest", "sql", "secrets", "iam", "deploy"):
                self.assertNotIn(word, command, f"unexpected '{word}' in a rollback step")

    def test_production_and_malformed_names_are_refused(self):
        bad_revisions = [
            "", "prooflab-web-bff-00004-9nn", "prooflab-staging-api-00004-9nn", "prooflab-staging-web-bff",
            "prooflab-staging-web-bff-00004-9nn=100 --to-latest", "prooflab-staging-web-bff-00004-9nn;rm -rf .",
            "prooflab-staging-web-bff-4-9nn", "LATEST", "prooflab-staging-web-bff-00004-9NN",
        ]
        for revision in bad_revisions:
            self.assertTrue(rollback.problems(revision, GOOD_VERSION), revision)
            with self.assertRaises(ValueError):
                rollback.plan(revision, GOOD_VERSION)

        bad_versions = [
            "", "939a668ef6990b3", "939a668ef6990b38a", "939A668EF6990B38", "sites/prooflab-508214/versions/79a3164cfe001a3b",
            '939a668ef6990b38"; curl evil', "../versions/1", "g39a668ef6990b38",
        ]
        for version in bad_versions:
            self.assertTrue(rollback.problems(GOOD_REVISION, version), version)
            with self.assertRaises(ValueError):
                rollback.plan(GOOD_REVISION, version)

    def test_running_it_prints_and_never_executes_or_connects(self):
        def forbidden(*args, **kwargs):
            raise AssertionError("the rollback plan tried to run or connect to something")

        out, err = io.StringIO(), io.StringIO()
        with mock.patch("subprocess.run", forbidden), mock.patch("subprocess.Popen", forbidden), \
                mock.patch("os.system", forbidden), mock.patch("urllib.request.urlopen", forbidden), \
                mock.patch("socket.socket", forbidden), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = rollback.main(["--stable-revision", GOOD_REVISION, "--site-version", GOOD_VERSION])

        self.assertEqual(code, 0)
        self.assertIn("NOTHING HAS BEEN RUN", out.getvalue())
        self.assertIn(GOOD_REVISION, out.getvalue())

    def test_a_refusal_prints_no_command(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = rollback.main(["--stable-revision", "prooflab-web-bff-00001-abc", "--site-version", GOOD_VERSION])

        self.assertEqual(code, 1)
        self.assertEqual(out.getvalue(), "")
        self.assertIn("refused", err.getvalue())
        self.assertNotIn("gcloud run", err.getvalue())

    def test_the_tool_imports_nothing_that_can_run_or_connect(self):
        source = Path(rollback.__file__).read_text(encoding="utf-8")
        for name in ("subprocess", "urllib", "socket", "requests", "os.system", "shutil"):
            self.assertNotIn(f"import {name}", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
