"""Load the public Google browser API key from build configuration."""
import os
import re
from pathlib import Path

KEY_PATTERN = re.compile(r"AIza[0-9A-Za-z_-]{20,}")


def google_api_key(env_file: str = ".env.production") -> str:
    key = os.environ.get("VITE_GOOGLE_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        config_path = Path(env_file)
        if not config_path.is_absolute():
            config_path = Path(__file__).resolve().parent.parent / config_path
        if config_path.is_file():
            for line in config_path.read_text(encoding="utf-8").splitlines():
                name, separator, value = line.partition("=")
                if separator and name.strip() == "VITE_GOOGLE_API_KEY":
                    key = value.strip().strip("\"'")
                    break

    if not key:
        raise RuntimeError(
            "Google API key is missing; set VITE_GOOGLE_API_KEY or configure it in "
            f"{env_file}."
        )
    if not KEY_PATTERN.fullmatch(key.strip()):
        raise RuntimeError("Google API key is not in the expected format.")
    return key.strip()
