"""STAGING ONLY. PRINTS the rollback commands for the web gateway and the website. Runs nothing.

    python scripts/dev-tools/staging_rollback_plan.py --stable-revision <rev> --site-version <id>

It makes no network call, runs no gcloud and changes nothing: it checks the two names you give it
and prints the commands for a person to read and run. It refuses anything that is not staging, so
a production name pasted by mistake cannot become a command.

Order matters and is printed that way: the gateway first (the site depends on it), then the site.
The values to pass are the ones written down at deploy time (docs/teja-release/S32-...md, section 8).
"""
import argparse
import re
import sys

PROJECT = "prooflab-508214"
REGION = "asia-south1"
SERVICE = "prooflab-staging-web-bff"
SITE = "prooflab-staging"
API = "https://firebasehosting.googleapis.com/v1beta1"

REVISION = re.compile(r"^prooflab-staging-web-bff-\d{5}-[a-z0-9]{3}$")
VERSION = re.compile(r"^[0-9a-f]{16}$")


def problems(stable_revision: str, site_version: str) -> list:
    """Every reason these two names must not be turned into commands. Empty list = allowed."""
    found = []
    if not REVISION.match(stable_revision or ""):
        found.append(f"'{stable_revision}' is not a revision of {SERVICE} (expected {SERVICE}-00000-xxx)")
    if not VERSION.match(site_version or ""):
        found.append(f"'{site_version}' is not a Hosting version id (expected 16 hex characters)")
    return found


def plan(stable_revision: str, site_version: str) -> list:
    """The commands, in the order to run them. Raises ValueError rather than print an unsafe one."""
    found = problems(stable_revision, site_version)
    if found:
        raise ValueError("; ".join(found))
    version = f"sites/{SITE}/versions/{site_version}"
    return [
        ("1. Gateway: send all staging traffic back to the known-good revision",
         f"gcloud run services update-traffic {SERVICE} --project {PROJECT} --region {REGION} "
         f"--to-revisions {stable_revision}=100"),
        ("2. Check the gateway answers (expect 200 JSON, session null)",
         f"curl -sS https://{SITE}.web.app/api/auth/session"),
        ("3. Website: release the previous version again",
         f'curl -sS -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" '
         f'-H "X-Goog-User-Project: {PROJECT}" '
         f'"{API}/sites/{SITE}/releases?versionName={version}"'),
        ("4. Check the site answers (expect 200)",
         f'curl -sS -o /dev/null -w "%{{http_code}}" https://{SITE}.web.app/'),
    ]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Print the staging rollback commands. Runs nothing.")
    parser.add_argument("--stable-revision", required=True)
    parser.add_argument("--site-version", required=True)
    args = parser.parse_args(argv)

    found = problems(args.stable_revision, args.site_version)
    if found:
        print("ROLLBACK PLAN: refused. Nothing was printed to run.", file=sys.stderr)
        for line in found:
            print(f"  - {line}", file=sys.stderr)
        return 1

    print("Staging rollback plan. NOTHING HAS BEEN RUN. Each step needs the owner's yes.\n")
    for title, command in plan(args.stable_revision, args.site_version):
        print(f"{title}\n    {command}\n")
    print("No database step: a gateway or site rollback changes no data.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
