"""Where the crawler reads and writes.

The app moved to Google: the database is Cloud SQL, reached through PostgREST on
Cloud Run. The crawler had to move with it, or it would keep filling a Supabase
table nobody reads any more - and that failure is silent. Students would simply
stop getting new material, with every run reporting success.

BACKEND=google is the default here, because that is where the live site points.
Setting BACKEND to anything else falls back to Supabase, which keeps the crawler
usable against the old system for as long as it exists.

Three operations, so this is hand-written rather than pulled from a library:
list the active sources, list what has already been stored for one of them, and
insert a row. supabase-py would work for the Supabase side but addresses tables
at <url>/rest/v1/<table>, and our PostgREST serves from the root - the same
mismatch the browser client works around, not worth importing a client for
three calls.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time

import httpx

BACKEND = os.environ.get("BACKEND", "google")
TIMEOUT = 30


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _service_token(secret: str) -> str:
    """A short-lived token carrying role=service_role.

    PostgREST decides what a caller may do from this claim. Ten minutes, minted
    per run, never written down. The secret it is signed with is the same one
    PostgREST was started with.
    """
    now = int(time.time())
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64(json.dumps(
        {"role": "service_role", "iat": now, "exp": now + 600}, separators=(",", ":"),
    ).encode())
    signing_input = f"{header}.{payload}".encode()
    signature = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{header}.{payload}.{_b64(signature)}"


def _bridge_token(signer: str) -> str:
    """A service_role token from the auth-bridge, proved with this job's Google identity."""
    identity = httpx.get(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity",
        params={"audience": signer}, headers={"Metadata-Flavor": "Google"}, timeout=10)
    identity.raise_for_status()
    reply = httpx.post(f"{signer}/service-token",
                       headers={"Authorization": f"Bearer {identity.text.strip()}"}, timeout=10)
    reply.raise_for_status()
    return reply.json()["access_token"]


class Database:
    """The two tables this crawler touches, on whichever backend is configured."""

    def __init__(self) -> None:
        if BACKEND == "google":
            self.base = os.environ["POSTGREST_URL"].rstrip("/")
            # F1: with SIGNER_URL set, the auth-bridge issues the token after checking
            # this job's own Google identity (the crawler holds no signing key).
            # Without it: the legacy self-signed token.
            signer = os.environ.get("SIGNER_URL", "").rstrip("/")
            token = _bridge_token(signer) if signer else _service_token(os.environ["PGRST_JWT_SECRET"])
            self.headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
        else:
            self.base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
            key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
            self.headers = {
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            }

    def _get(self, path: str, params: dict) -> list[dict]:
        # Cloud Run sleeps when idle, so the first request of a run can meet a
        # cold start, and a home connection drops now and then. Neither is a
        # reason to abandon a crawl - one transient failure ended an entire run
        # before this was added.
        last: Exception | None = None
        for attempt in range(3):
            try:
                r = httpx.get(f"{self.base}/{path}", params=params,
                              headers=self.headers, timeout=TIMEOUT)
                r.raise_for_status()
                return r.json()
            except (httpx.HTTPError, ValueError) as err:
                last = err
                if attempt < 2:
                    time.sleep(2 * (attempt + 1))
        raise RuntimeError(f"could not read {path}: {last}")

    def active_sources(self) -> list[dict]:
        return self._get("source_registry", {"select": "*", "retired_at": "is.null"})

    def existing_for_source(self, source_id: str) -> list[dict]:
        # canonical_url and id are needed as well as the hashes: a page that is
        # crawled again must be recognised and updated, not stored a second time.
        return self._get("source_content", {
            "select": "id,canonical_url,content_hash,simhash",
            "source_id": f"eq.{source_id}",
        })

    def insert_content(self, row: dict) -> None:
        r = httpx.post(
            f"{self.base}/source_content",
            json=row,
            headers={**self.headers, "Prefer": "return=minimal"},
            timeout=TIMEOUT,
        )
        # Surface the server's own words. "insert failed" tells nobody which
        # constraint objected.
        if r.status_code >= 400:
            raise RuntimeError(f"insert failed, HTTP {r.status_code}: {r.text[:300]}")

    def update_content(self, row_id: str, row: dict) -> None:
        """Replace what is stored for a page that has been re-read."""
        r = httpx.patch(
            f"{self.base}/source_content",
            params={"id": f"eq.{row_id}"},
            json=row,
            headers={**self.headers, "Prefer": "return=minimal"},
            timeout=TIMEOUT,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"update failed, HTTP {r.status_code}: {r.text[:300]}")

    def days_since_newest_page(self) -> int | None:
        """Whole days since any page was last stored or changed; None when there is none."""
        rows = self._get("source_content", {"select": "fetched_at", "order": "fetched_at.desc", "limit": "1"})
        if not rows or not rows[0].get("fetched_at"):
            return None
        from datetime import datetime, timezone
        newest = datetime.fromisoformat(rows[0]["fetched_at"].replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - newest).days

    def describe(self) -> str:
        return f"{BACKEND} ({self.base})"
