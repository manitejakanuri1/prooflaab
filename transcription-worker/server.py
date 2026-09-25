"""Step 6: the private Cloud Tasks worker for async voice transcription.

POST /transcribe-job {"voice_id": "<uuid>"} - called only by Cloud Tasks, over
an OIDC token Cloud Run itself checks before this process ever sees the
request (deployed --no-allow-unauthenticated; only the dedicated invoker
service account may call it).

Idempotency lives in the database, not here: claim_transcription_job() only
lets one live attempt hold a row at a time, and a stale claim (worker crashed
mid-job) expires on its own after STALE_AFTER_SECONDS so a retry can pick it
back up. A duplicate delivery of the same task finds nothing to claim and
returns success having done nothing twice.

Reuses the EXISTING faster-whisper service (prooflab-staging-transcriber) for
the actual transcription - this worker does not run Whisper itself, it only
orchestrates: fetch the audio the browser already uploaded, hand it to the
existing transcriber, write the result back through prooflab-staging-api.
"""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8080"))
JWT_SECRET = os.environ.get("PGRST_JWT_SECRET", "").encode()
POSTGREST_URL = os.environ.get("POSTGREST_URL", "").rstrip("/")
TRANSCRIBER_URL = os.environ.get("TRANSCRIBER_URL", "").rstrip("/")
PRIVATE_BUCKET = os.environ.get("PRIVATE_BUCKET", "")
STALE_AFTER_SECONDS = int(os.environ.get("STALE_AFTER_SECONDS", "180"))
# Must match the queue's own configured max-attempts (prooflab-staging-transcription: 3).
# Cloud Tasks' retry-count header is 0-indexed, so attempt 2 is the last one it will make.
QUEUE_MAX_ATTEMPTS = int(os.environ.get("QUEUE_MAX_ATTEMPTS", "3"))


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def service_token(ttl: int = 300) -> str:
    """A short-lived, self-issued token this service is trusted to hold - the
    same HS256 scheme every other internal call in this project already uses.
    role=authenticated (not service_role) because that is what the existing
    prooflab-staging-transcriber already accepts, unchanged."""
    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64url(json.dumps({
        "role": "authenticated", "sub": "transcription-worker", "iat": now, "exp": now + ttl,
    }).encode())
    sig = hmac.new(JWT_SECRET, f"{header}.{payload}".encode(), hashlib.sha256).digest()
    return f"{header}.{payload}.{b64url(sig)}"


def db_rpc(name: str, args: dict):
    token = service_token()
    req = urllib.request.Request(
        f"{POSTGREST_URL}/rpc/{name}",
        data=json.dumps(args).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def google_access_token() -> str:
    req = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())["access_token"]


def fetch_audio(storage_path: str) -> tuple[bytes, str]:
    """Reads the audio the browser already uploaded, straight from the staging
    bucket via the GCS API - this worker is a trusted backend process, not a
    student request, so it does not go through files-service's per-student
    ownership check (that check exists for browser callers; it has nothing to
    decide here, the job row it was handed already names the right file)."""
    token = google_access_token()
    obj = urllib.parse.quote(f"voice-explanations/{storage_path}", safe="")
    url = f"https://storage.googleapis.com/storage/v1/b/{PRIVATE_BUCKET}/o/{obj}?alt=media"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        content_type = r.headers.get("Content-Type") or "audio/webm"
        return r.read(), content_type


def transcribe(audio: bytes, content_type: str) -> dict:
    token = service_token()
    req = urllib.request.Request(
        f"{TRANSCRIBER_URL}/transcribe", data=audio, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply(200 if self.path == "/ready" else 404, {"ok": self.path == "/ready"})

    def do_POST(self):
        if self.path != "/transcribe-job":
            return self.reply(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self.reply(400, {"error": "bad json"})

        voice_id = body.get("voice_id")
        task_name = self.headers.get("X-Cloudtasks-Taskname", "")
        retry_count = int(self.headers.get("X-Cloudtasks-Taskretrycount", "0"))
        if not voice_id:
            return self.reply(400, {"error": "voice_id required"})

        status, claimed = db_rpc("claim_transcription_job",
                                  {"_id": voice_id, "_stale_after_seconds": STALE_AFTER_SECONDS})
        if status != 200:
            print(f"WORKER: claim failed for {voice_id} (task={task_name}): {status} {claimed}", flush=True)
            return self.reply(500, {"error": "claim failed"})
        if not claimed:
            # Nothing to do: already completed, already failed-and-not-retried,
            # or another live attempt currently holds this row. Exactly the
            # duplicate-delivery and concurrent-retry case this is meant to
            # make safe - reprocessing was correctly skipped, not an error.
            print(f"WORKER: nothing to claim for {voice_id} (task={task_name}) - already handled or in progress", flush=True)
            return self.reply(200, {"ok": True, "skipped": True})

        job = claimed[0]
        storage_path = job["storage_path"]
        try:
            if not storage_path:
                raise ValueError("job has no storage_path")
            audio, content_type = fetch_audio(storage_path)
            result = transcribe(audio, content_type)
            text = result.get("text") or ""
            segments = result.get("segments")
            words = len(text.split()) if text else 0
            ok = db_rpc("complete_transcription_job",
                        {"_id": voice_id, "_transcript": text, "_segments": segments, "_word_count": words})[1]
            print(f"WORKER: completed {voice_id} (task={task_name}, attempt={job['attempts']}) words={words} db_updated={ok}", flush=True)
            return self.reply(200, {"ok": True, "voice_id": voice_id, "words": words})
        except Exception as e:
            err = str(e)[:300]
            terminal = retry_count >= QUEUE_MAX_ATTEMPTS - 1
            db_rpc("fail_transcription_job", {"_id": voice_id, "_error": err, "_terminal": terminal})
            print(f"WORKER: failed {voice_id} (task={task_name}, attempt={job['attempts']}, "
                  f"retry_count={retry_count}, terminal={terminal}): {err}", flush=True)
            # 500 so Cloud Tasks retries per the queue's own policy - a transient
            # fetch/transcriber error gets another attempt automatically, and the
            # row goes back to 'pending' (not 'failed') unless this was the last one.
            return self.reply(500, {"error": err})


if __name__ == "__main__":
    print(f"transcription-worker listening on :{PORT}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
