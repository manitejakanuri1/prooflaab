"""STAGING ONLY, READ-ONLY. Is the web BFF canary safe to promote? Nothing is changed anywhere.

    python scripts/dev-tools/staging_bff_preflight.py
    python scripts/dev-tools/staging_bff_preflight.py --canary-revision <rev> --stable-revision <rev> --tag <tag>

What it does, and all it does:
  * ONE `gcloud run services describe` (read-only) of the staging BFF;
  * anonymous HTTP GETs, with a timeout, no cookies, no Authorization header, no redirects followed.

It never signs in, never sends a password, never creates an account, never writes to a database and
never moves traffic. It refuses to look at anything that is not a staging service.

It prints PASS / FAIL per check and exits 0 only if every check passed (fail closed: an unexpected
revision, origin, route, answer or error is a FAIL, never a skip). Response bodies and configuration
values are never printed: only status codes, content types and the names of things.

Checks:
  identity   the service is the one asked for (name, region, its own service account in the project)
  traffic    the stable revision takes 100% of normal traffic and does not follow "latest";
             the canary tag points at the expected revision and takes 0%
  config     the canary's release switch (BFF_RELEASE_READY) is off; the session key is a secret
             reference; every upstream is a staging https run.app address; the staging site is an
             allowed browser origin
  canary     /health 200 JSON; /ready 503 JSON (closed); /api/auth/session 200 {"session": null};
             protected routes 401 JSON; an unknown path 404 JSON
  stable     the revision users are on still answers /api/auth/session and keeps /ready closed
  site       the staging website's /api/** reaches the BFF (JSON, not the app's HTML page)
  upstreams  each backend answers its own documented health contract
"""
import argparse
import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT = "prooflab-508214"
REGION = "asia-south1"
SERVICE = "prooflab-staging-web-bff"
SITE = "https://prooflab-staging.web.app"
STAGING_MARK = "prooflab-staging-"
# Cloud Run domain suffix observed for this project's existing staging services.
# Fail closed on a lookalike service hosted in a different Cloud Run project.
PROJECT_RUN_SUFFIX = "-ysn2mpe6sa-el.a.run.app"
# A preflight CLI override must never broaden this specific project's targets.
ALLOWED_ORIGINS = frozenset({SITE, "https://prooflab-staging.firebaseapp.com"})
UPSTREAM_HOST_PREFIXES = {
    "AUTH_BRIDGE_URL": "prooflab-staging-auth-bridge-",
    "FUNCTIONS_URL": "prooflab-staging-functions-",
    "ACCOUNTS_URL": "prooflab-staging-accounts-",
    "TRANSCRIBER_URL": "prooflab-staging-transcriber-",
    "FILES_URL": "prooflab-staging-files-",
    "POSTGREST_URL": "prooflab-staging-api-",
}
SESSION_SECRET = "prooflab-staging-web-bff-session-key"
BFF_NAME = "prooflab-web-bff"            # what the BFF calls itself in /health and /ready
# T48 (9 Oct 2026). Stale values here cannot pass by accident: a different live revision is a FAIL.
CANARY_REVISION = "prooflab-staging-web-bff-00005-wuh"
STABLE_REVISION = "prooflab-staging-web-bff-00004-9nn"
TAG = "s23"

TIMEOUT = 30            # seconds, every HTTP call
UPSTREAM_TIMEOUT = 90   # a scaled-to-zero backend (the voice model) needs longer to start
MAX_BODY = 64 * 1024    # never read more than this of any answer

# name of the BFF setting -> (path, expected status, JSON field, expected value): the backend's own
# health contract. files-service has no /ready; its own JSON 404 is the contract its uptime check uses.
UPSTREAMS = {
    "AUTH_BRIDGE_URL": ("/ready", 200, "ok", True),
    "FUNCTIONS_URL": ("/ready", 200, "ok", True),
    "ACCOUNTS_URL": ("/ready", 200, "ok", True),
    "TRANSCRIBER_URL": ("/ready", 200, "ok", True),
    "FILES_URL": ("/", 404, "error", "not found"),
}
# Checked for shape only (https, staging): its root answer is the whole schema, too big to be a health check.
UPSTREAM_SHAPE_ONLY = ("POSTGREST_URL",)
# Anonymous GETs that must be refused. GET only: this tool sends nothing else.
PROTECTED = ("/api/db/profiles", "/api/files/preflight/probe")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def http_get(url, timeout=TIMEOUT):
    """Anonymous GET. Returns (status, content type, first MAX_BODY bytes). Raises if unreachable."""
    opener = urllib.request.build_opener(_NoRedirect)
    request = urllib.request.Request(url, method="GET", headers={"Accept": "application/json", "User-Agent": "prooflab-staging-bff-preflight"})
    try:
        with opener.open(request, timeout=timeout) as res:
            return res.status, res.headers.get("Content-Type", ""), res.read(MAX_BODY)
    except urllib.error.HTTPError as error:      # 4xx / 5xx are answers, not failures to connect
        return error.code, error.headers.get("Content-Type", ""), error.read(MAX_BODY)


def describe_argv(gcloud, project, region, service):
    """The only command this tool ever runs. `describe` cannot change anything."""
    return [gcloud, "run", "services", "describe", service, f"--project={project}", f"--region={region}", "--format=json"]


def gcloud_describe(project, region, service):
    gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not gcloud:
        raise RuntimeError("gcloud was not found")
    out = subprocess.run(describe_argv(gcloud, project, region, service), capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise RuntimeError("gcloud could not describe the service")      # stderr is not echoed
    return json.loads(out.stdout)


def staging_run_url(value):
    """The address if it is an https run.app address of a staging service, else None."""
    try:
        url = urllib.parse.urlsplit(value or "")
    except ValueError:
        return None
    host = url.hostname or ""
    try:
        port = url.port
    except ValueError:
        return None
    ok = (url.scheme == "https" and (host.startswith(STAGING_MARK) or host.startswith(TAG + "---" + STAGING_MARK))
          and host.endswith(PROJECT_RUN_SUFFIX) and not url.username and not url.password
          and port is None and url.path in ("", "/") and not url.query and not url.fragment)
    return f"https://{host}" if ok else None


def refuse_unsafe_target(args):
    """Reasons this tool must not run at all. It is a staging tool; it never inspects production."""
    reasons = []
    if args.project != PROJECT:
        reasons.append(f"project must be {PROJECT}")
    if args.region != REGION:
        reasons.append(f"region must be {REGION}")
    if args.service != SERVICE:
        reasons.append(f"service must be exactly {SERVICE}")
    if args.site != SITE:
        reasons.append(f"site must be exactly {SITE}")
    for label in ("canary_revision", "stable_revision"):
        if not getattr(args, label).startswith(args.service + "-"):
            reasons.append(f"{label} is not a revision of {args.service}")
    if args.canary_revision == args.stable_revision:
        reasons.append("canary and stable revision are the same")
    return reasons


def run(args, describe=gcloud_describe, http=http_get):
    """Every check as (ok, name, detail). Detail never contains a response body or a configuration value."""
    results = []

    def check(name, ok, detail=""):
        results.append((bool(ok), name, detail))
        return bool(ok)

    def answer(name, url, status, expect, timeout=TIMEOUT):
        """GET url; pass only for exactly `status`, JSON, and expect(body) true."""
        try:
            code, ctype, raw = http(url, timeout)
        except Exception as error:
            return check(name, False, f"no answer ({type(error).__name__})")
        is_json = "application/json" in (ctype or "").lower()
        try:
            body = json.loads(raw.decode("utf-8")) if is_json else None
        except (ValueError, UnicodeDecodeError):
            body, is_json = None, False
        kind = "JSON" if is_json else ("HTML" if "html" in (ctype or "").lower() else "not JSON")
        ok = code == status and is_json and bool(expect(body))
        return check(name, ok, f"HTTP {code}, {kind}" + ("" if ok else f" (expected HTTP {status} JSON with the documented answer)"))

    # ---- identity, traffic, configuration: one read-only describe -----------------------------
    try:
        svc = describe(args.project, args.region, args.service)
        meta, spec, status = svc.get("metadata") or {}, svc.get("spec") or {}, svc.get("status") or {}
    except Exception as error:
        check("identity: service can be described", False, f"{type(error).__name__}")
        return results

    template = spec.get("template") or {}
    container = ((template.get("spec") or {}).get("containers") or [{}])[0]
    account = (template.get("spec") or {}).get("serviceAccountName") or ""
    check("identity: service name", meta.get("name") == args.service, f"asked for {args.service}")
    check("identity: region", (meta.get("labels") or {}).get("cloud.googleapis.com/location") == args.region, f"expected {args.region}")
    check("identity: runs as its own service account in this project",
          account == f"{args.service}@{args.project}.iam.gserviceaccount.com", "expected <service>@<project>")
    # If the described identity is not the expected one, contact NO URLs at all.
    if any(not passed for passed, _, _ in results):
        return results

    traffic = status.get("traffic") or []
    stable = [t for t in traffic if t.get("revisionName") == args.stable_revision and not t.get("tag")]
    tagged = [t for t in traffic if t.get("tag") == args.tag]
    others = [t for t in traffic if t not in stable and (t.get("percent") or 0) > 0]
    live_stable = sorted({t.get("revisionName") for t in traffic if (t.get("percent") or 0) > 0})
    check("traffic: stable revision takes 100% of normal traffic",
          len(stable) == 1 and stable[0].get("percent") == 100 and not others,
          f"expected {args.stable_revision}; revisions with traffic now: {live_stable}")
    check("traffic: normal traffic is pinned, not following the latest revision",
          not any(t.get("latestRevision") for t in traffic if (t.get("percent") or 0) > 0))
    tag_ok = len(tagged) == 1 and tagged[0].get("revisionName") == args.canary_revision
    check(f"traffic: tag '{args.tag}' points at the expected canary revision", tag_ok,
          f"expected {args.canary_revision}; tag points at {[t.get('revisionName') for t in tagged]}")
    check(f"traffic: tag '{args.tag}' takes 0% of normal traffic", len(tagged) == 1 and not (tagged[0].get("percent") or 0))
    check("traffic: canary is the newest revision (the configuration below is the canary's)",
          status.get("latestCreatedRevisionName") == args.canary_revision == status.get("latestReadyRevisionName"),
          "a newer revision exists" if status.get("latestCreatedRevisionName") != args.canary_revision else "")

    def own_address(value, prefix):
        """The address only if it is a staging run.app address whose host starts with `prefix`. Else None: not contacted."""
        url = staging_run_url(value)
        return url if url and urllib.parse.urlsplit(url).hostname.startswith(prefix) else None

    service_url = own_address(status.get("url"), args.service + "-")
    canary_url = own_address(tagged[0].get("url"), f"{args.tag}---{args.service}-") if tag_ok else None
    check("routing: service address is this staging service", bool(service_url))
    check("routing: canary address is the tagged address of this service", bool(canary_url))

    env = {}
    for item in container.get("env") or []:
        env[item.get("name")] = item      # values stay in memory; only names are ever reported
    plain = lambda name: (env.get(name) or {}).get("value") or ""  # noqa: E731
    switch_off = plain("BFF_RELEASE_READY") != "true"
    check("config: release switch BFF_RELEASE_READY is off", switch_off,
          "" if switch_off else "it is on: /ready may open and the 503 check below no longer proves anything")
    secret = (env.get("SESSION_KEY") or {})
    secret_ref = (secret.get("valueFrom") or {}).get("secretKeyRef") or {}
    check("config: SESSION_KEY comes from the correct staging secret",
          (secret_ref.get("name") == SESSION_SECRET and secret_ref.get("key") == "latest"
           and "value" not in secret))

    upstream = {}
    for name in (*UPSTREAMS, *UPSTREAM_SHAPE_ONLY):
        address = staging_run_url(plain(name))
        hostname = urllib.parse.urlsplit(address).hostname if address else ""
        # A merely staging-looking service in another project is not sufficient.
        upstream[name] = address if hostname.startswith(UPSTREAM_HOST_PREFIXES[name]) else None
    wrong = sorted(name for name, url in upstream.items() if not url)
    check("config: every upstream is a staging https run.app address", not wrong, f"not staging or not set: {wrong}" if wrong else "")
    origins = [o.strip() for o in plain("BROWSER_ORIGINS").split(",") if o.strip()]
    site = args.site.rstrip("/")
    check("config: the staging site is an allowed browser origin", site in origins, f"{len(origins)} origins configured")
    check("config: no allowed browser origin is plain http",
          bool(origins) and all(o.startswith("https://") for o in origins))
    check("config: all allowed browser origins are approved staging sites",
          bool(origins) and set(origins).issubset(ALLOWED_ORIGINS))

    # ---- the canary itself ----------------------------------------------------------------------
    session_null = lambda b: isinstance(b, dict) and "session" in b and b["session"] is None  # noqa: E731
    refused = lambda b: isinstance(b, dict) and b.get("error") == "not authenticated"  # noqa: E731
    closed = lambda b: isinstance(b, dict) and b.get("ok") is False and b.get("service") == BFF_NAME  # noqa: E731
    if canary_url:
        answer("canary: /health is 200 JSON from the BFF", f"{canary_url}/health", 200,
               lambda b: b == {"ok": True, "service": BFF_NAME})
        answer("canary: /ready is closed (503)", f"{canary_url}/ready", 503, closed)
        answer("canary: anonymous /api/auth/session is 200 with no session", f"{canary_url}/api/auth/session", 200, session_null)
        for path in PROTECTED:
            answer(f"canary: anonymous {path} is refused (401)", f"{canary_url}{path}", 401, refused)
        answer("canary: an unknown path is 404 JSON (nothing is proxied by default)", f"{canary_url}/preflight-unknown-path", 404,
               lambda b: isinstance(b, dict) and b.get("error") == "not found")
    else:
        check("canary: reachable at its tagged address", False, "no trusted canary address, so nothing was contacted")

    # ---- what users are on now --------------------------------------------------------------------
    if service_url:
        answer("stable: anonymous /api/auth/session is 200 with no session", f"{service_url}/api/auth/session", 200, session_null)
        answer("stable: /ready is closed (503)", f"{service_url}/ready", 503, closed)
    else:
        check("stable: reachable at the service address", False, "no trusted service address, so nothing was contacted")

    # ---- the staging website routes /api/** to the BFF -----------------------------------------
    answer("site: /api/auth/session reaches the BFF (JSON, not the app page)", f"{site}/api/auth/session", 200, session_null)
    answer(f"site: anonymous {PROTECTED[0]} is refused (401 JSON)", f"{site}{PROTECTED[0]}", 401, refused)

    # ---- upstreams, each by its own health contract; only addresses proven to be staging ---------
    for name, (path, code, field, value) in UPSTREAMS.items():
        label = f"upstream: {name[:-4].lower().replace('_', '-')} answers its health contract"
        if upstream.get(name):
            answer(label, upstream[name] + path, code, lambda b, f=field, v=value: isinstance(b, dict) and b.get(f) == v, UPSTREAM_TIMEOUT)
        else:
            check(label, False, "address is not a staging address, so it was not contacted")
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read-only preflight of the staging web BFF canary.")
    parser.add_argument("--project", default=PROJECT)
    parser.add_argument("--region", default=REGION)
    parser.add_argument("--service", default=SERVICE)
    parser.add_argument("--site", default=SITE)
    parser.add_argument("--tag", default=TAG)
    parser.add_argument("--canary-revision", default=CANARY_REVISION)
    parser.add_argument("--stable-revision", default=STABLE_REVISION)
    args = parser.parse_args(argv)

    reasons = refuse_unsafe_target(args)
    if reasons:
        for reason in reasons:
            print("REFUSED:", reason)
        print("STAGING_BFF_PREFLIGHT=REFUSED (nothing was contacted)")
        return 2

    results = run(args)
    for ok, name, detail in results:
        print("PASS" if ok else "FAIL", name + (f" - {detail}" if detail else ""), flush=True)
    failed = sum(1 for ok, _, _ in results if not ok)
    print(f"\n{len(results) - failed}/{len(results)} checks passed")
    print(f"STAGING_BFF_PREFLIGHT={'PASS' if not failed else 'FAIL'}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
