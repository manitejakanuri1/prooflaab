from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]

t11 = root / "docs/teja-release/T11_STAGING_RELEASE_GATE.md"
t12 = root / "docs/teja-release/T12_PREFLIGHT_REPORT.md"

if not t11.is_file() or not t12.is_file():
    raise SystemExit("STOP: T11 or T12 report missing")

source = t11.read_text(encoding="utf-8")
report = t12.read_text(encoding="utf-8")

# Parse each service section separately.
# Never match SITE_URL across neighboring services.
sections = re.findall(
    r"(?ms)^### (prooflab-staging-[a-z0-9-]+)[ \t]*\n"
    r"(.*?)(?=^### |^## |\Z)",
    source,
)

names = [name for name, _ in sections]

if len(names) != 10 or len(set(names)) != 10:
    raise SystemExit(
        f"STOP: Expected 10 unique services, found {len(names)}"
    )

missing = sorted(
    name
    for name, body in sections
    if re.search(
        r"(?m)^- SITE_URL: MISSING - RELEASE BLOCKER\s*$",
        body,
    )
)

expected = sorted([
    "prooflab-staging-accounts",
    "prooflab-staging-functions",
])

if missing != expected:
    raise SystemExit(
        "STOP: T11 evidence differs from expected findings: "
        + repr(missing)
    )

new_row = (
    "| Staging SITE_URL | "
    + ", ".join(missing)
    + " | BLOCKED |"
)

pattern = r"(?m)^\| Staging SITE_URL \|[^\n]*\| BLOCKED \|$"

updated, count = re.subn(
    pattern,
    lambda _: new_row,
    report,
)

if count != 1:
    raise SystemExit(
        f"STOP: Expected exactly one T12 SITE_URL row, found {count}"
    )

t12.write_text(updated, encoding="utf-8")

assert new_row in t12.read_text(encoding="utf-8")

print("PASS: Parsed all 10 service sections")
print("PASS: Correct missing SITE_URL services")
print("PASS: T12 report repaired")
print(new_row)
