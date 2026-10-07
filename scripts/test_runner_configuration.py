import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read_services(environment: str) -> dict:
    path = ROOT / "infra" / environment / "services.json"
    return json.loads(path.read_text(encoding="utf-8"))


class RunnerConfigurationTests(unittest.TestCase):
    def test_production_functions_use_iam_runner_and_keep_rollback_secret(self):
        functions = read_services("production")["prooflab-functions"]["env"]
        self.assertEqual(functions["CODE_RUNNER_AUTH"], "iam")
        self.assertEqual(
            functions["CODE_RUNNER_URL"],
            "https://prooflab-code-runner-rc-lfnoedpoca-el.a.run.app",
        )
        self.assertEqual(functions["CODE_RUNNER_SECRET"]["secret"], "code-runner-secret")

    def test_dedicated_runner_allows_only_backend_service_accounts(self):
        runner = read_services("runner")["prooflab-code-runner-rc"]
        allowed = set(runner["env"]["RUNNER_ALLOWED_CALLERS"].split(","))
        invokers = set(runner["invokers"])
        self.assertEqual(
            allowed,
            {
                "prooflab-rt-functions@prooflab-508214.iam.gserviceaccount.com",
                "prooflab-staging-functions@prooflab-508214.iam.gserviceaccount.com",
            },
        )
        self.assertEqual(
            invokers,
            {f"serviceAccount:{email}" for email in allowed},
        )
        self.assertNotIn("RUNNER_SECRET", runner["env"])


if __name__ == "__main__":
    unittest.main()
