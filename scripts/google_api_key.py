"""The Google sign-in API key for check scripts.

Since 31 Oct 2026 the key lives only in Secret Manager (prooflab-identity-api-key), never in the repo.
An environment variable (VITE_GOOGLE_API_KEY or GOOGLE_API_KEY) still wins, for CI or one-off runs.
"""
import os
import re
import subprocess

KEY_PATTERN = re.compile(r"AIza[0-9A-Za-z_-]{20,}")
SECRET = "prooflab-identity-api-key"


def google_api_key() -> str:
    key = os.environ.get("VITE_GOOGLE_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        try:
            key = subprocess.run(
                ["gcloud", "secrets", "versions", "access", "latest", f"--secret={SECRET}",
                 "--project=prooflab-508214"],
                capture_output=True, text=True, check=True, shell=os.name == "nt",
            ).stdout
        except (OSError, subprocess.CalledProcessError):
            key = ""
    key = (key or "").strip()
    if not key:
        raise RuntimeError(f"Google API key is missing; set VITE_GOOGLE_API_KEY or allow gcloud to read secret {SECRET}.")
    if not KEY_PATTERN.fullmatch(key):
        raise RuntimeError("Google API key is not in the expected format.")
    return key
