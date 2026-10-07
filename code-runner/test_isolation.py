import unittest
from unittest.mock import patch

import server


class NetworkIsolationTests(unittest.TestCase):
    def test_run_does_not_plan_or_start_code_without_verified_isolation(self):
        with patch.object(server, "NET_ISOLATION", False):
            with patch.object(server, "plan") as plan:
                with self.assertRaisesRegex(OSError, "network isolation unavailable"):
                    server.run("python", "print('must not run')", "")
                plan.assert_not_called()


if __name__ == "__main__":
    unittest.main()
