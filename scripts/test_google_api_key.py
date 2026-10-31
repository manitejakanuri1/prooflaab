import os
import subprocess
import unittest
from unittest.mock import patch

from google_api_key import google_api_key


class GoogleApiKeyTests(unittest.TestCase):
    def test_environment_value_takes_precedence(self):
        with patch.dict(os.environ, {"VITE_GOOGLE_API_KEY": "AIza" + "A" * 35}):
            self.assertEqual(google_api_key(), "AIza" + "A" * 35)

    def test_reads_key_from_secret_manager(self):
        done = subprocess.CompletedProcess([], 0, stdout="AIza" + "B" * 35 + "\n")
        with patch.dict(os.environ, {}, clear=True), patch("subprocess.run", return_value=done) as run:
            self.assertEqual(google_api_key(), "AIza" + "B" * 35)
            self.assertIn("--secret=prooflab-identity-api-key", run.call_args[0][0])

    def test_missing_key_fails_explicitly(self):
        with patch.dict(os.environ, {}, clear=True), patch("subprocess.run", side_effect=OSError):
            with self.assertRaisesRegex(RuntimeError, "Google API key is missing"):
                google_api_key()


if __name__ == "__main__":
    unittest.main()
