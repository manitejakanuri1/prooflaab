import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from google_api_key import google_api_key


class GoogleApiKeyTests(unittest.TestCase):
    def test_environment_value_takes_precedence(self):
        with patch.dict(os.environ, {"VITE_GOOGLE_API_KEY": "AIza" + "A" * 35}):
            self.assertEqual(google_api_key("missing.env"), "AIza" + "A" * 35)

    def test_reads_key_from_build_environment_file(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / ".env"
            config.write_text('VITE_GOOGLE_API_KEY="AIza' + "B" * 35 + '"\n', encoding="utf-8")
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(google_api_key(str(config)), "AIza" + "B" * 35)

    def test_missing_key_fails_explicitly(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "Google API key is missing"):
                    google_api_key(str(Path(directory) / "missing.env"))


if __name__ == "__main__":
    unittest.main()
