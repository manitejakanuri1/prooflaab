"""Fails if a tracked file looks like it contains a secret (release gate, Wave 9).

    python scripts/secret_scan.py

Secrets live only in Secret Manager. This is a tripwire for the obvious mistakes: a pasted
private key, an API key, a database URL with a password, a signed token. It reads tracked
text files only and prints the file and line number, never the matched text.
"""
import re, subprocess, sys

PATTERNS = {
    "private key block": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----\s*\n[A-Za-z0-9+/=\s]{200,}"),
    "provider API key (sk-...)": re.compile(r"\bsk-[A-Za-z0-9_-]{24,}\b"),
    "Google API key": re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b"),
    "GitHub token": re.compile(r"\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}\b"),
    "Google service-account key file": re.compile(r'"private_key"\s*:\s*"-----BEGIN'),
    "database URL with a password": re.compile(r"postgres(?:ql)?://[^\s:/@'\"]+:[^\s@'\"${}<>]{6,}@(?!localhost|127\.0\.0\.1|db:|postgres:)[^\s'\"]+"),
    "signed token (JWT)": re.compile(r"\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{30,}\b"),
    "Slack token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{20,}\b"),
}
# Files that legitimately contain look-alikes (fakes written into tests, lock files).
SKIP = re.compile(r"(^|/)(package-lock\.json|bun\.lockb?|.*\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|gz|zip|lockb))$")
ALLOW_LINE = re.compile(r"secret-scan: allow")
PUBLIC_GOOGLE_KEY_FIELDS = {
    ".env.example": "VITE_GOOGLE_API_KEY",
    ".env.production": "VITE_GOOGLE_API_KEY",
    ".env.staging": "VITE_GOOGLE_API_KEY",
    "infra/production/services.json": "GOOGLE_API_KEY",
}


def public_browser_key():
    try:
        text = open(".env.production", encoding="utf-8").read()
    except OSError:
        return None
    for line in text.splitlines():
        name, separator, value = line.partition("=")
        if separator and name.strip() == "VITE_GOOGLE_API_KEY":
            return value.strip().strip("\"'")
    return None


def is_documented_public_google_key(path, line, key, expected_key):
    normalized_path = path.replace("\\", "/")
    if (
        normalized_path == "supabase/functions/_shared/log_test.ts"
        and "const s = scrub(" in line
        and key == expected_key
    ):
        return True
    field = PUBLIC_GOOGLE_KEY_FIELDS.get(normalized_path)
    if not field or not expected_key or key != expected_key:
        return False
    if normalized_path.startswith(".env."):
        return re.fullmatch(rf"\s*{re.escape(field)}={re.escape(key)}\s*", line) is not None
    return re.search(rf'"{re.escape(field)}"\s*:\s*"{re.escape(key)}"', line) is not None

files = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n")
findings = []
public_key = public_browser_key()
for f in files:
    if not f or SKIP.search(f):
        continue
    try:
        text = open(f, encoding="utf-8").read()
    except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
        continue
    for name, pat in PATTERNS.items():
        for m in pat.finditer(text):
            line_no = text.count("\n", 0, m.start()) + 1
            line = text.split("\n")[line_no - 1]
            if ALLOW_LINE.search(line):
                continue
            if name == "Google API key" and is_documented_public_google_key(f, line, m.group(), public_key):
                continue
            findings.append(f"{f}:{line_no}: looks like a {name}")

for line in findings:
    print("SECRET?", line)
print(f"scanned {len(files)} tracked files, {len(findings)} findings")
sys.exit(1 if findings else 0)
