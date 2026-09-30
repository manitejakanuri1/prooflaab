"""Publish dist/ to Firebase Hosting using the gcloud credential.

The Firebase CLI on this machine is signed in as a different Google account and
its token has expired, and re-authenticating needs a browser. Hosting has a
plain REST API, and gcloud is already signed in as the project owner, so this
uses that instead: no second login, no service-account key file.

The upload is content-addressed. Each file is gzipped, hashed, and the hashes
are offered to Google, which replies with only the ones it does not already
have. A redeploy that changes one file therefore uploads one file.

Usage:
    python scripts/deploy-hosting.py [dist-dir]
"""

import gzip
import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

PROJECT = "prooflab-508214"
SITE = "prooflab-508214"
API = "https://firebasehosting.googleapis.com/v1beta1"
DIST = sys.argv[1] if len(sys.argv) > 1 else "dist"

def find_gcloud() -> str:
    """Wherever gcloud happens to live.

    On the GitHub runner it is on PATH; on the Windows laptop it is not, and
    the launcher there is a .cmd. Hardcoding the laptop path made this fail on
    the runner with a Windows filename inside a Linux error message, which
    reads as a far stranger problem than it is.
    """
    if os.environ.get("GCLOUD"):
        return os.environ["GCLOUD"]

    found = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if found:
        return found

    raise SystemExit(
        "gcloud was not found. Put it on PATH, or set GCLOUD to its full path."
    )


GCLOUD = find_gcloud()


def token() -> str:
    out = subprocess.run(
        [GCLOUD, "auth", "print-access-token"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


TOKEN = token()
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Goog-User-Project": PROJECT,
    "Content-Type": "application/json",
}


def call(method: str, path: str, body=None, raw: bytes | None = None,
         headers: dict | None = None, url: str | None = None):
    target = url or f"{API}/{path}"
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(target, data=data, method=method,
                                 headers=headers or HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=180) as res:
            payload = res.read()
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:400]
        raise SystemExit(f"{method} {target} failed: HTTP {e.code}\n{detail}")


# ---------------------------------------------------------------------------
# 1. gzip and hash every file
# ---------------------------------------------------------------------------

files: dict[str, tuple[str, bytes]] = {}   # "/path" -> (sha256, gzipped bytes)

for root, _, names in os.walk(DIST):
    for name in names:
        full = os.path.join(root, name)
        rel = "/" + os.path.relpath(full, DIST).replace(os.sep, "/")
        with open(full, "rb") as fh:
            # mtime=0 so the same input always produces the same hash; otherwise
            # every deploy would look like every file had changed.
            blob = gzip.compress(fh.read(), mtime=0)
        files[rel] = (hashlib.sha256(blob).hexdigest(), blob)

print(f"  {len(files)} files prepared")

# ---------------------------------------------------------------------------
# 2. create a version
# ---------------------------------------------------------------------------

version = call("POST", f"sites/{SITE}/versions", {
    "config": {
        # A single-page app: every unknown path must return index.html, or a
        # visitor refreshing /dashboard gets a 404 instead of the dashboard.
        "rewrites": [{"glob": "**", "path": "/index.html"}],
        "headers": [
            {
                # Security headers on every response. Deliberately no full script CSP:
                # the lesson editor loads Monaco from its CDN. frame-ancestors blocks
                # other sites from framing ProofLab (clickjacking); the in-page
                # sandboxed practice iframe is same-page srcdoc, unaffected.
                # Microphone stays allowed for ProofLab itself (voice explanations).
                "glob": "**",
                "headers": {
                    "X-Content-Type-Options": "nosniff",
                    "Referrer-Policy": "strict-origin-when-cross-origin",
                    "Permissions-Policy": "microphone=(self), camera=(), geolocation=(), payment=(), usb=()",
                    "X-Frame-Options": "SAMEORIGIN",
                    "Content-Security-Policy": "frame-ancestors 'self'",
                },
            },
            {
                # Fingerprinted assets never change under the same name, so they
                # can be cached hard. index.html must not be, or a deploy is
                # invisible until browsers expire it.
                "glob": "/assets/**",
                "headers": {"Cache-Control": "public, max-age=31536000, immutable"},
            },
            {
                # Every page address, not just the literal /index.html: "/" and
                # "/student/dashboard" are rewritten to index.html but matched on
                # their own path, so they got Firebase's default max-age=3600 and
                # visitors saw the previous deploy for up to an hour.
                "glob": "**/!(*.*)",
                "headers": {"Cache-Control": "no-cache"},
            },
            {
                "glob": "**/*.html",
                "headers": {"Cache-Control": "no-cache"},
            },
        ],
    },
})
version_name = version["name"]
print(f"  version: {version_name.split('/')[-1]}")

# ---------------------------------------------------------------------------
# 3. tell Google what we have; it asks for what it lacks
# ---------------------------------------------------------------------------

populate = call("POST", f"{version_name}:populateFiles",
                {"files": {path: h for path, (h, _) in files.items()}})
wanted = populate.get("uploadRequiredHashes", []) or []
upload_url = populate.get("uploadUrl", "")
print(f"  {len(wanted)} of {len(files)} need uploading")

by_hash = {h: blob for (h, blob) in files.values()}
for i, h in enumerate(wanted, 1):
    call("POST", "", raw=by_hash[h], url=f"{upload_url}/{h}",
         headers={"Authorization": f"Bearer {TOKEN}",
                  "Content-Type": "application/octet-stream"})
    if i % 25 == 0 or i == len(wanted):
        print(f"    uploaded {i}/{len(wanted)}")

# ---------------------------------------------------------------------------
# 4. finalize and release
# ---------------------------------------------------------------------------

call("PATCH", f"{version_name}?updateMask=status", {"status": "FINALIZED"})
release = call("POST", f"sites/{SITE}/releases?versionName={version_name}", {})
print(f"  released: {release.get('name','').split('/')[-1]}")
print("  live at https://prooflab-508214.web.app")
