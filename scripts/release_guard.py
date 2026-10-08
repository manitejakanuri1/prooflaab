"""Fail-closed guard for publishing the website (Firebase Hosting).

    python scripts/release_guard.py [dist-dir]        # exit 0 = may publish, exit 1 = refused (reasons printed)

Why: the website no longer talks to the backend directly. Every sign-in and every data call goes to
same-origin /api/**, which Hosting must rewrite to the web BFF (Cloud Run). A site published WITHOUT
that rewrite looks fine and lets nobody sign in. scripts/deploy-hosting.py used to publish happily
with no BFF configured ("When unset, Hosting behaviour stays exactly as before").

Nothing here deploys, and nothing is changed anywhere: it reads environment variables and the built
files, and (only when asked to) makes one GET to the BFF's own /healthz.

Rules - every one must hold, otherwise nothing is published:

  any site
    * dist/index.html exists (a real build)
    * BFF_SERVICE names the gateway; BFF_REGION is asia-south1
  the production site (HOSTING_SITE unset or prooflab-508214)
    * BFF_SERVICE is exactly prooflab-web-bff          (never a staging service)
    * the build is not a staging build                 (no staging service address inside it)
    * PRODUCTION_RELEASE_APPROVED_SHA is the full commit being published
      - the owner sets it, per release, as a repository variable; a push alone is not approval
    * BFF_HEALTH_URL is the production gateway's https://...run.app address and its /healthz answers
      {"ok": true, "service": "prooflab-web-bff"}      (the gateway must exist BEFORE the site needs it)
  a staging site (HOSTING_SITE contains "staging")
    * BFF_SERVICE is a staging service                 (a staging site must never drive the production gateway)
"""
import json
import os
import re
import subprocess
import sys
import urllib.request

PRODUCTION_SITE = "prooflab-508214"
PRODUCTION_BFF = "prooflab-web-bff"
REGION = "asia-south1"
SHA = re.compile(r"^[0-9a-f]{40}$")
HEALTH_URL = re.compile(r"^https://[a-z0-9-]+\.[a-z0-9.-]*run\.app/?$")
STAGING_MARK = "prooflab-staging-"


def current_commit(env) -> str:
    """The commit being published: GitHub's own value on the runner, git otherwise."""
    sha = (env.get("GITHUB_SHA") or "").strip()
    if sha:
        return sha
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return ""


def fetch_health(url: str) -> dict:
    with urllib.request.urlopen(url.rstrip("/") + "/healthz", timeout=20) as res:
        return json.loads(res.read().decode("utf-8"))


def built_text(dist: str) -> str:
    """index.html plus every script of the build, for the staging-build check."""
    parts = []
    for root, _dirs, names in os.walk(dist):
        for name in names:
            if name == "index.html" or name.endswith(".js"):
                with open(os.path.join(root, name), encoding="utf-8", errors="replace") as fh:
                    parts.append(fh.read())
    return "\n".join(parts)


def problems(site, env, dist, health=fetch_health, commit=None, read_build=built_text) -> list:
    """Every reason this publish must not happen. Empty list = allowed."""
    found = []
    site = (site or PRODUCTION_SITE).strip()
    production = site == PRODUCTION_SITE
    staging = "staging" in site
    bff = (env.get("BFF_SERVICE") or "").strip()
    region = (env.get("BFF_REGION") or REGION).strip()

    if not os.path.isfile(os.path.join(dist, "index.html")):
        found.append(f"{dist}/index.html is missing: there is no build to publish")
    if not production and not staging:
        found.append(f"unknown Hosting site '{site}': only the production site and a staging site may be published")
    if not bff:
        found.append("BFF_SERVICE is not set: the site would be published with no /api route and nobody could sign in")
    if region != REGION:
        found.append(f"BFF_REGION is '{region}', expected {REGION}")

    if staging:
        if bff and "staging" not in bff:
            found.append(f"a staging site must use a staging gateway, not '{bff}'")
        return found
    if not production:
        return found

    if bff and bff != PRODUCTION_BFF:
        found.append(f"production must route /api to '{PRODUCTION_BFF}', not '{bff}'")

    if os.path.isdir(dist) and STAGING_MARK in read_build(dist):
        found.append("this is a staging build (it contains a staging service address): build with the production settings")

    head = commit if commit is not None else current_commit(env)
    approved = (env.get("PRODUCTION_RELEASE_APPROVED_SHA") or "").strip().lower()
    if not SHA.match(head or ""):
        found.append("cannot tell which commit is being published")
    if not approved:
        found.append("PRODUCTION_RELEASE_APPROVED_SHA is not set: the owner has not approved a production release")
    elif not SHA.match(approved):
        found.append("PRODUCTION_RELEASE_APPROVED_SHA must be the full 40-character commit id")
    elif approved != (head or "").lower():
        found.append(f"the approval is for commit {approved[:7]}, but this publish is commit {(head or '?')[:7]}: approve this commit first")

    url = (env.get("BFF_HEALTH_URL") or "").strip()
    if not url:
        found.append("BFF_HEALTH_URL is not set: cannot confirm the production gateway exists")
    elif not HEALTH_URL.match(url):
        found.append("BFF_HEALTH_URL must be the gateway's own https://...run.app address")
    elif STAGING_MARK in url:
        found.append("BFF_HEALTH_URL points at a staging service")
    else:
        try:
            body = health(url)
            if not (isinstance(body, dict) and body.get("ok") is True and body.get("service") == PRODUCTION_BFF):
                found.append("the production gateway did not answer /healthz as prooflab-web-bff")
        except Exception as error:  # unreachable, wrong address, not deployed: all mean "do not publish"
            found.append(f"the production gateway is not reachable ({type(error).__name__}): deploy it before the site")
    return found


def enforce(site, env, dist) -> None:
    """Stop the process unless every rule holds. Called by deploy-hosting.py before anything is uploaded."""
    found = problems(site, env, dist)
    if found:
        print("RELEASE GUARD: publish refused. Nothing was uploaded.", file=sys.stderr)
        for line in found:
            print(f"  - {line}", file=sys.stderr)
        raise SystemExit(1)
    print(f"release guard: ok ({(site or PRODUCTION_SITE)} -> {env.get('BFF_SERVICE')})")


if __name__ == "__main__":
    enforce(os.environ.get("HOSTING_SITE", PRODUCTION_SITE), os.environ, sys.argv[1] if len(sys.argv) > 1 else "dist")
