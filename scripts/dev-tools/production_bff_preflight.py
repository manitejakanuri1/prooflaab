"""PRODUCTION, READ-ONLY. Is production ready for the website to be published with /api/** routed to
the web BFF? Nothing is changed anywhere. It answers a question; it deploys nothing.

    python scripts/dev-tools/production_bff_preflight.py

The target is fixed in this file and cannot be changed by an argument: project prooflab-508214, region
asia-south1, service prooflab-web-bff, site https://prooflab.co.in. A staging service is never accepted
as the production gateway, whatever it answers.

What it does, and all it does:
  * `gcloud run services list` (read-only), once
  * `gcloud run services get-iam-policy prooflab-web-bff` (read-only), only if that service exists
  * anonymous HTTP GETs with a timeout: no cookie, no Authorization header, no redirect followed

It never signs in, never sends a password, never reads a secret value, never writes to a database and
never moves traffic. Printed: PASS / FAIL, status codes, content types and names. Never printed:
response bodies or configuration values.

Exit 0 only if EVERY check passed. A check that cannot be made is a FAIL, never a skip. The app's own
HTML page answering on an /api path is a FAIL: that is the website, not the API.

Checks:
  service    prooflab-web-bff exists in production; own service account; public (Hosting must reach it);
             all normal traffic pinned to one revision
  config     session key is a production Secret Manager reference; six upstreams are the production
             services (https run.app, never staging); browser origins are https, include the site,
             and name no staging or local address
  bridge     the production auth-bridge signs with its own key and lists the BFF as a service-token caller
             (the BFF cannot read its session store without both)
  gateway    /health 200 JSON; /ready 200 "ready" (this is the proof that the session table, the
             service token and every backend really work); anonymous session 200 null; protected 401
  site       https://prooflab.co.in/api/** answers BFF JSON, not the app page
  upstreams  each production backend answers its own health contract
"""
import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

PROJECT = "prooflab-508214"
REGION = "asia-south1"
SERVICE = "prooflab-web-bff"
BRIDGE = "prooflab-auth-bridge"
SITE = "https://prooflab.co.in"
BFF_NAME = "prooflab-web-bff"
STAGING_WORDS = ("staging", "localhost", "127.0.0.1")
DEFAULT_COMPUTE_SUFFIX = "-compute@developer.gserviceaccount.com"

TIMEOUT = 30
UPSTREAM_TIMEOUT = 90
MAX_BODY = 64 * 1024

# BFF setting -> (production service it must point at, path, status, JSON field, value). None path = shape only.
UPSTREAMS = {
    "AUTH_BRIDGE_URL": ("prooflab-auth-bridge", "/ready", 200, "ok", True),
    "FUNCTIONS_URL": ("prooflab-functions", "/ready", 200, "ok", True),
    "ACCOUNTS_URL": ("prooflab-accounts", "/ready", 200, "ok", True),
    "TRANSCRIBER_URL": ("prooflab-transcriber", "/ready", 200, "ok", True),
    "FILES_URL": ("prooflab-files", "/", 404, "error", "not found"),
    "POSTGREST_URL": ("prooflab-api", None, None, None, None),
}
PROTECTED = ("/api/db/profiles", "/api/files/preflight/probe")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def http_get(url, timeout=TIMEOUT):
    """Anonymous GET. Returns (status, content type, first MAX_BODY bytes). Raises if unreachable."""
    opener = urllib.request.build_opener(_NoRedirect)
    request = urllib.request.Request(url, method="GET", headers={"Accept": "application/json", "User-Agent": "prooflab-production-bff-preflight"})
    try:
        with opener.open(request, timeout=timeout) as res:
            return res.status, res.headers.get("Content-Type", ""), res.read(MAX_BODY)
    except urllib.error.HTTPError as error:
        return error.code, error.headers.get("Content-Type", ""), error.read(MAX_BODY)


def gcloud_argv(gcloud, what):
    """The only two commands this tool can run. Both only read."""
    commands = {
        "list": ["run", "services", "list", f"--region={REGION}"],
        "policy": ["run", "services", "get-iam-policy", SERVICE, f"--region={REGION}"],
    }
    return [gcloud, *commands[what], f"--project={PROJECT}", "--format=json"]


def gcloud_read(what):
    gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not gcloud:
        raise RuntimeError("gcloud was not found")
    out = subprocess.run(gcloud_argv(gcloud, what), capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        raise RuntimeError("gcloud could not read")       # stderr is not echoed
    return json.loads(out.stdout)


def production_run_url(value, service):
    """The address if it is the https run.app address of exactly this production service, else None."""
    try:
        url = urllib.parse.urlsplit(value or "")
    except ValueError:
        return None
    host = (url.hostname or "").lower()
    ok = (url.scheme == "https" and host.endswith(".run.app") and host.startswith(service + "-")
          and not any(word in host for word in STAGING_WORDS) and not url.username and url.path in ("", "/") and not url.query)
    return f"https://{host}" if ok else None


def container_env(service):
    template = ((service.get("spec") or {}).get("template") or {}).get("spec") or {}
    container = (template.get("containers") or [{}])[0]
    return {item.get("name"): item for item in container.get("env") or []}, template.get("serviceAccountName") or ""


def run(read=gcloud_read, http=http_get):
    """Every check as (ok, name, detail). Detail never holds a response body or a configuration value."""
    results = []

    def check(name, ok, detail=""):
        results.append((bool(ok), name, detail))
        return bool(ok)

    def answer(name, url, status, expect, timeout=TIMEOUT):
        try:
            code, ctype, raw = http(url, timeout)
        except Exception as error:
            return check(name, False, f"no answer ({type(error).__name__})")
        is_json = "application/json" in (ctype or "").lower()
        try:
            body = json.loads(raw.decode("utf-8")) if is_json else None
        except (ValueError, UnicodeDecodeError):
            body, is_json = None, False
        kind = "JSON" if is_json else ("HTML page (the website, not the API)" if "html" in (ctype or "").lower() else "not JSON")
        ok = code == status and is_json and bool(expect(body))
        extra = ""
        if not ok and is_json and isinstance(body, dict) and body.get("service") == BFF_NAME:
            # The BFF's own not-ready answer names things only (never values): safe to show.
            state, failed = body.get("state"), body.get("failed")
            if isinstance(state, str) and state.replace("-", "").isalpha():
                extra = f"; state={state}"
            if isinstance(failed, list) and all(isinstance(x, str) and x.replace("-", "").replace("_", "").isalnum() for x in failed):
                extra += f"; failed={failed}"
        return check(name, ok, f"HTTP {code}, {kind}{extra}" + ("" if ok else f" (expected HTTP {status} JSON with the documented answer)"))

    plain = lambda env, name: (env.get(name) or {}).get("value") or ""  # noqa: E731
    secret_of = lambda env, name: (((env.get(name) or {}).get("valueFrom") or {}).get("secretKeyRef") or {}).get("name") or ""  # noqa: E731
    session_null = lambda b: isinstance(b, dict) and "session" in b and b["session"] is None  # noqa: E731
    refused = lambda b: isinstance(b, dict) and b.get("error") == "not authenticated"  # noqa: E731

    # ---- what exists -------------------------------------------------------------------------------
    try:
        services = {(s.get("metadata") or {}).get("name"): s for s in read("list")}
    except Exception as error:
        check("service: production services can be listed", False, type(error).__name__)
        services = None

    bff = (services or {}).get(SERVICE)
    bridge = (services or {}).get(BRIDGE)
    service_url = None
    bff_account = ""

    if services is not None:
        staging_only = sorted(n for n in services if n and "web-bff" in n and n != SERVICE)
        check(f"service: {SERVICE} exists in production", bff is not None,
              "" if bff is not None else f"NOT DEPLOYED. Other gateways seen and NOT accepted: {staging_only or 'none'}")

    if bff is not None:
        env, bff_account = container_env(bff)
        status = bff.get("status") or {}
        shared = sorted(n for n, s in services.items() if n != SERVICE and container_env(s)[1] == bff_account)
        check("service: runs as its own production service account",
              bff_account.endswith(f"@{PROJECT}.iam.gserviceaccount.com") and "staging" not in bff_account
              and not bff_account.endswith(DEFAULT_COMPUTE_SUFFIX) and not shared,
              f"shared with {shared}" if shared else "")
        traffic = [t for t in status.get("traffic") or [] if (t.get("percent") or 0) > 0]
        check("service: all normal traffic is pinned to one revision",
              len(traffic) == 1 and traffic[0].get("percent") == 100 and bool(traffic[0].get("revisionName")) and not traffic[0].get("latestRevision"),
              f"{len(traffic)} revision(s) take traffic")
        service_url = production_run_url(status.get("url"), SERVICE)
        check("service: address is this production service", bool(service_url))
        try:
            policy = read("policy")
            invokers = sorted(m for b in (policy or {}).get("bindings", []) if b.get("role") in ("roles/run.invoker", "roles/run.servicesInvoker") for m in b.get("members", []))
            check("service: public invoker (the website must be able to reach it)", "allUsers" in invokers, f"{len(invokers)} invoker(s)")
        except Exception as error:
            check("service: public invoker (the website must be able to reach it)", False, type(error).__name__)

        # ---- configuration -------------------------------------------------------------------------
        key_secret = secret_of(env, "SESSION_KEY")
        check("config: SESSION_KEY is a production Secret Manager reference",
              bool(key_secret) and "staging" not in key_secret and "value" not in (env.get("SESSION_KEY") or {}))
        upstream = {name: production_run_url(plain(env, name), spec[0]) for name, spec in UPSTREAMS.items()}
        wrong = sorted(name for name, url in upstream.items() if not url)
        check("config: all six upstreams are the production services (never staging)", not wrong, f"wrong or not set: {wrong}" if wrong else "")
        origins = [o.strip() for o in plain(env, "BROWSER_ORIGINS").split(",") if o.strip()]
        check("config: the production site is an allowed browser origin", SITE in origins, f"{len(origins)} origin(s) configured")
        check("config: browser origins are https and name no staging or local address",
              bool(origins) and all(o.startswith("https://") and not any(w in o.lower() for w in STAGING_WORDS) for o in origins))
        check("config: no setting points at staging",
              not any(any(w in str((item.get("value") or "")).lower() for w in STAGING_WORDS) or "staging" in secret_of(env, name) for name, item in env.items()))
    else:
        upstream = {}
        for name in ("service: runs as its own production service account", "service: all normal traffic is pinned to one revision",
                     "service: public invoker (the website must be able to reach it)", "config: SESSION_KEY is a production Secret Manager reference",
                     "config: all six upstreams are the production services (never staging)", "config: the production site is an allowed browser origin"):
            check(name, False, "cannot be true: the service does not exist")

    # ---- the auth-bridge must be able to issue the BFF a service token -------------------------------
    if bridge is not None:
        benv, _ = container_env(bridge)
        check("bridge: signs with its own key (APP_SIGNING_KEY from Secret Manager)", bool(secret_of(benv, "APP_SIGNING_KEY")),
              "" if secret_of(benv, "APP_SIGNING_KEY") else "not set: /service-token answers 401, so the BFF cannot read its session store")
        check("bridge: SERVICE_TOKEN_AUDIENCE is set", bool(plain(benv, "SERVICE_TOKEN_AUDIENCE")))
        callers = [c.strip() for c in plain(benv, "SERVICE_TOKEN_CALLERS").split(",") if c.strip()]
        check("bridge: the BFF's service account is a service-token caller", bool(bff_account) and bff_account in callers, f"{len(callers)} caller(s) listed")
        check("bridge: no staging identity is a production service-token caller", not any("staging" in c for c in callers))
    else:
        check("bridge: production auth-bridge can be inspected", False, "service not found" if services is not None else "services could not be listed")

    # ---- the gateway itself --------------------------------------------------------------------------
    if service_url:
        answer("gateway: /health is 200 JSON from the BFF", f"{service_url}/health", 200, lambda b: b == {"ok": True, "service": BFF_NAME})
        answer("gateway: /ready is OPEN (200, ready) - session store, service token and backends proven", f"{service_url}/ready", 200,
               lambda b: isinstance(b, dict) and b.get("ok") is True and b.get("service") == BFF_NAME and b.get("state") == "ready")
        answer("gateway: anonymous /api/auth/session is 200 with no session", f"{service_url}/api/auth/session", 200, session_null)
        for path in PROTECTED:
            answer(f"gateway: anonymous {path} is refused (401)", f"{service_url}{path}", 401, refused)
    else:
        check("gateway: reachable at its own production address", False, "no trusted address, so nothing was contacted")

    # ---- the website: /api/** must reach the BFF, not the app page -----------------------------------
    answer("site: /api/auth/session answers BFF JSON (not the app page)", f"{SITE}/api/auth/session", 200, session_null)
    answer(f"site: anonymous {PROTECTED[0]} is refused (401 JSON)", f"{SITE}{PROTECTED[0]}", 401, refused)

    # ---- production backends, at the addresses production itself reports ------------------------------
    for name, (service, path, code, field, value) in UPSTREAMS.items():
        if path is None:
            continue
        label = f"upstream: {service} answers its health contract"
        live = production_run_url((((services or {}).get(service) or {}).get("status") or {}).get("url"), service)
        configured = upstream.get(name)
        if bff is not None and configured != live:
            check(label, False, "the BFF's setting is not this service's own address")
        elif live:
            answer(label, live + path, code, lambda b, f=field, v=value: isinstance(b, dict) and b.get(f) == v, UPSTREAM_TIMEOUT)
        else:
            check(label, False, "production service address unknown, so it was not contacted")
    return results


def main(argv=None):
    if (sys.argv[1:] if argv is None else argv):
        print("REFUSED: this tool takes no arguments. Its target is fixed: production " + SERVICE)
        print("PRODUCTION_BFF_PREFLIGHT=REFUSED (nothing was contacted)")
        return 2
    results = run()
    for ok, name, detail in results:
        print("PASS" if ok else "FAIL", name + (f" - {detail}" if detail else ""), flush=True)
    failed = sum(1 for ok, _, _ in results if not ok)
    print(f"\n{len(results) - failed}/{len(results)} checks passed")
    print("Not covered: a real sign-in, and the migration ledger itself. /ready = 200 proves the session table and the service token work; it does not prove sign-in.")
    print(f"PRODUCTION_BFF_PREFLIGHT={'PASS' if not failed else 'FAIL'}")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
