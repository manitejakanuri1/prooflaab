"""Step 6: the private Cloud Tasks worker for async voice transcription.

POST /transcribe-job {"voice_id": "<uuid>"} - called only by Cloud Tasks, over
an OIDC token Cloud Run itself checks before this process ever sees the
request (deployed --no-allow-unauthenticated; only the dedicated invoker
service account may call it).

Idempotency lives in the database, not here: claim_transcription_job() only
lets one live attempt hold a row at a time, and a stale claim (worker crashed
mid-job) expires on its own after STALE_AFTER_SECONDS. A duplicate delivery of
the same task finds nothing to claim and returns success having done nothing
twice. A lease token (returned by the claim, required by complete/fail) means
a call from an attempt that turned out to be stale - not dead, just slow -
can never overwrite what a newer attempt already saved.

STALE_AFTER_SECONDS (180s) is deliberately longer than this queue's own retry
window (3 attempts, 5-30s backoff exhausts in well under a minute) - a
genuinely crashed worker's claim outlives every Cloud Tasks retry attempt, so
Cloud Tasks alone cannot rediscover it. transcription-reap (a separate,
staging-only function) is what actually recovers a crashed job: it finds rows
stale past this same window and re-enqueues them, independent of whatever is
left of the original task's retry budget.

Reuses the EXISTING faster-whisper service (prooflab-staging-transcriber) for
the actual transcription - this worker does not run Whisper itself, it only
orchestrates: fetch the audio the browser already uploaded, hand it to the
existing transcriber, write the result back through prooflab-staging-api.
"""
import base64
import apptoken
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8080"))
JWT_SECRET = os.environ.get("PGRST_JWT_SECRET", "").encode()
POSTGREST_URL = os.environ.get("POSTGREST_URL", "").rstrip("/")
SIGNER_URL = os.environ.get("SIGNER_URL", "").rstrip("/")
TRANSCRIBER_URL = os.environ.get("TRANSCRIBER_URL", "").rstrip("/")
# Step 6 G1: the functions service whose voice-score grades the transcript
# this worker just saved, so scoring no longer waits for the student's browser.
FUNCTIONS_URL = os.environ.get("FUNCTIONS_URL", "").rstrip("/")
PRIVATE_BUCKET = os.environ.get("PRIVATE_BUCKET", "")
STALE_AFTER_SECONDS = int(os.environ.get("STALE_AFTER_SECONDS", "180"))
# Must match the queue's own configured max-attempts (prooflab-staging-transcription: 3).
# Cloud Tasks' retry-count header is 0-indexed, so attempt 2 is the last one it will make.
QUEUE_MAX_ATTEMPTS = int(os.environ.get("QUEUE_MAX_ATTEMPTS", "3"))
# "staging" or "production". Fault injection is only ever honoured on staging.
ENVIRONMENT = os.environ.get("ENVIRONMENT", "")
# Step 6C, staging test use only: after a REAL claim (a genuine Cloud Tasks
# delivery, not a hand-crafted RPC call) for this one voice_id, hang instead
# of transcribing - simulating a worker that crashed mid-job while holding a
# live lease, so scheduled recovery can be proven against a claim the worker
# itself made. Must not be left set after a test. Refused outside staging
# (see check_config).
FAULT_INJECT_VOICE_ID = os.environ.get("FAULT_INJECT_VOICE_ID", "")

REQUIRED = {
    "SIGNER_URL (or legacy PGRST_JWT_SECRET)": SIGNER_URL or JWT_SECRET, "POSTGREST_URL": POSTGREST_URL, "TRANSCRIBER_URL": TRANSCRIBER_URL,
    "FUNCTIONS_URL": FUNCTIONS_URL, "PRIVATE_BUCKET": PRIVATE_BUCKET, "ENVIRONMENT": ENVIRONMENT,
}


def check_config() -> list[str]:
    """Problems that must stop the worker from starting (empty list = fine).
    A revision that fails here never becomes ready, so Cloud Run keeps
    serving the previous, working one."""
    problems = [f"{k} is not set" for k, v in REQUIRED.items() if not v]
    if ENVIRONMENT and ENVIRONMENT not in ("staging", "production"):
        problems.append(f"ENVIRONMENT must be staging or production, got {ENVIRONMENT!r}")
    # Belt and braces: an ENVIRONMENT label that disagrees with the database
    # it points at is refused, so a mislabelled production worker cannot
    # switch fault injection on.
    if ENVIRONMENT == "staging" and "-staging-" not in POSTGREST_URL:
        problems.append("ENVIRONMENT=staging but POSTGREST_URL is not a staging URL")
    if ENVIRONMENT == "production" and "-staging-" in POSTGREST_URL:
        problems.append("ENVIRONMENT=production but POSTGREST_URL is a staging URL")
    if FAULT_INJECT_VOICE_ID and ENVIRONMENT != "staging":
        problems.append("FAULT_INJECT_VOICE_ID is set outside staging - refusing to start")
    if QUEUE_MAX_ATTEMPTS < 1 or STALE_AFTER_SECONDS < 1:
        problems.append("QUEUE_MAX_ATTEMPTS and STALE_AFTER_SECONDS must be >= 1")
    return problems


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def mint_token(role: str, ttl: int = 300) -> str:
    """A short-lived service token. With SIGNER_URL set it comes from the auth-bridge,
    which checks this service's Google identity (F1) - the worker holds no signing key.
    Without it: the legacy self-signed HS256 token. `role` is kept for the call sites;
    both the database RPCs and the transcriber accept a service token."""
    # The configuration read at start-up, not the live environment.
    return apptoken.service_token({"SIGNER_URL": SIGNER_URL, "PGRST_JWT_SECRET": JWT_SECRET.decode()})


MALFORMED = object()  # a 200 whose body is not valid JSON


def db_rpc(name: str, args: dict):
    """(http_status, body). http_status is None when the database could not be
    reached at all; body is MALFORMED when a 200 carried unreadable JSON.
    Never raises, so every caller has to decide what each case means."""
    token = mint_token("service_role")
    req = urllib.request.Request(
        f"{POSTGREST_URL}/rpc/{name}",
        data=json.dumps(args).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            try:
                return r.status, (json.loads(raw) if raw else None)
            except json.JSONDecodeError:
                return r.status, MALFORMED
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:  # network failure, timeout
        return None, str(e)[:200]


def google_access_token() -> str:
    req = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())["access_token"]


def fetch_audio(storage_path: str) -> tuple[bytes, str]:
    """Reads the audio the browser already uploaded, straight from the private
    bucket via the GCS API - this worker is a trusted backend process, not a
    student request, so it does not go through files-service's per-student
    ownership check (the job row it was handed already names the right file)."""
    token = google_access_token()
    obj = urllib.parse.quote(f"voice-explanations/{storage_path}", safe="")
    url = f"https://storage.googleapis.com/storage/v1/b/{PRIVATE_BUCKET}/o/{obj}?alt=media"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        content_type = r.headers.get("Content-Type") or "audio/webm"
        return r.read(), content_type


def transcribe(audio: bytes, content_type: str) -> dict:
    token = mint_token("authenticated")
    req = urllib.request.Request(
        f"{TRANSCRIBER_URL}/transcribe", data=audio, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def request_scoring(voice_id: str) -> str:
    """Step 6 G1: ask voice-score to grade a transcript this worker saved.

    Best effort by design: the transcript is already safely stored, so a
    failure here must not make Cloud Tasks retry the whole job (a retry would
    find nothing to claim and do nothing). transcription-reap scores any
    server transcript left unscored, and voice-score's migration-45 claim
    makes a duplicate request grade nothing twice.

    Returns a short summary for the log: HTTP status and outcome flags only -
    never the score notes or the response body, which are about the student."""
    token = mint_token("service_role")
    req = urllib.request.Request(
        f"{FUNCTIONS_URL}/voice-score", data=json.dumps({"voice_id": voice_id}).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, b""
    except Exception as e:  # network failure, timeout
        return f"unreachable ({type(e).__name__})"
    try:
        body = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        body = {}
    flags = {k: body[k] for k in ("success", "pending", "lost_race") if isinstance(body, dict) and k in body}
    return f"HTTP {status} {flags}" if flags else f"HTTP {status}"


def release_lease(voice_id: str, lease_token: str, error: str, terminal: bool) -> tuple[bool, str]:
    """fail_transcription_job, with its answer actually checked.
    (True, ...)  the database confirms the job was released/failed;
    (False, ...) it was not - either a newer attempt holds the row (a genuine
             false: not an error) or the call itself failed (reported loudly)."""
    status, body = db_rpc("fail_transcription_job", {
        "_id": voice_id, "_lease_token": lease_token, "_error": error, "_terminal": terminal})
    if status == 200 and body is True:
        return True, "released"
    if status == 200 and body is False:
        return False, "not released: a newer attempt holds this job (stale lease)"
    return False, f"FAIL-REPORT ERROR: fail_transcription_job returned status={status} body={'malformed' if body is MALFORMED else type(body).__name__}"


def process_job(voice_id: str, task_name: str, retry_count: int) -> tuple[int, dict]:
    """The whole job. Returns (http_code, body) for Cloud Tasks: 2xx acknowledges
    the task, anything else makes Cloud Tasks retry it (per the queue policy)."""
    status, claimed = db_rpc("claim_transcription_job",
                             {"_id": voice_id, "_stale_after_seconds": STALE_AFTER_SECONDS})
    if status != 200 or not isinstance(claimed, list):
        print(f"WORKER: claim failed for {voice_id} (task={task_name}): status={status}", flush=True)
        return 500, {"error": "claim failed"}
    if not claimed:
        # Nothing to do: already completed, already failed-and-not-retried,
        # or another live attempt holds this row. Exactly the duplicate-delivery
        # and concurrent-retry case this is meant to make safe.
        print(f"WORKER: nothing to claim for {voice_id} (task={task_name}) - already handled or in progress", flush=True)
        return 200, {"ok": True, "skipped": True}

    job = claimed[0]
    storage_path = job.get("storage_path")
    lease_token = job.get("lease_token")
    terminal = retry_count >= QUEUE_MAX_ATTEMPTS - 1

    if ENVIRONMENT == "staging" and FAULT_INJECT_VOICE_ID and (
            FAULT_INJECT_VOICE_ID == "ANY" or voice_id == FAULT_INJECT_VOICE_ID):
        print(f"WORKER: FAULT INJECTION (staging) - simulating a crash after a genuine claim "
              f"for {voice_id} (task={task_name})", flush=True)
        time.sleep(3600)
        return 500, {"error": "fault injection"}

    try:
        if not storage_path:
            raise ValueError("job has no storage_path")
        audio, content_type = fetch_audio(storage_path)
        result = transcribe(audio, content_type)
        text = result.get("text") or ""
        segments = result.get("segments")
        words = len(text.split()) if text else 0
        lang_meta = result.get("language_meta")
    except Exception as e:
        err = str(e)[:300]
        # The transcriber saying "I cannot read this recording" (4xx) will say the same on
        # every retry: close the job now so the student is told, instead of retrying for minutes.
        # "No instance available" (429) and server errors are worth retrying.
        if isinstance(e, urllib.error.HTTPError) and e.code in (400, 413, 415, 422):
            terminal = True
        released, how = release_lease(voice_id, lease_token, err, terminal)
        print(f"WORKER: failed {voice_id} (task={task_name}, attempt={job.get('attempts')}, "
              f"retry_count={retry_count}, terminal={terminal}): {err} | {how}", flush=True)
        # 500 either way so Cloud Tasks retries per the queue policy. If the
        # release itself failed, the lease still expires (STALE_AFTER_SECONDS)
        # and transcription-reap recovers the job.
        return 500, {"error": err, "released": released}

    # English-only (migration 69). The transcriber detects the language before it
    # transcribes. What it heard is stored with the recording either way; a clearly
    # non-English recording is closed here - no transcript, never scored - and the
    # student is asked to record again in English. Not a retry case: 200.
    if isinstance(lang_meta, dict):
        rejected = bool(result.get("non_english"))
        status, ok = db_rpc("set_transcription_language",
                            {"_id": voice_id, "_lease_token": lease_token, "_meta": lang_meta, "_reject": rejected})
        if rejected:
            if status == 200 and ok is True:
                print(f"WORKER: non-English recording {voice_id} (task={task_name}) - detected "
                      f"{lang_meta.get('language')} p={lang_meta.get('language_probability')}; not transcribed, not scored", flush=True)
                return 200, {"ok": True, "voice_id": voice_id, "non_english": True}
            released, how = release_lease(voice_id, lease_token, "could not record the language decision", terminal)
            print(f"WORKER: language decision NOT saved for {voice_id} (task={task_name}): status={status} | {how}", flush=True)
            return 500, {"error": "language decision not saved", "released": released}
        if not (status == 200 and ok is True):
            # Metadata only; the transcript below is what matters. Say so and carry on.
            print(f"WORKER: language metadata not saved for {voice_id} (task={task_name}): status={status}", flush=True)

    # The lease token must match: if a NEWER attempt already reclaimed this row
    # (this attempt was stale - slow, not dead), the database does nothing.
    status, saved = db_rpc("complete_transcription_job",
                           {"_id": voice_id, "_lease_token": lease_token,
                            "_transcript": text, "_segments": segments, "_word_count": words})
    if status == 200 and saved is True:
        print(f"WORKER: completed {voice_id} (task={task_name}, attempt={job.get('attempts')}) words={words}", flush=True)
        # Only the attempt whose transcript the database confirms saved asks
        # for scoring.
        print(f"WORKER: scoring requested for {voice_id}: {request_scoring(voice_id)}", flush=True)
        return 200, {"ok": True, "voice_id": voice_id, "words": words}
    if status == 200 and saved is False:
        # A genuine "no": a newer attempt owns this job now. Acknowledge the
        # task (retrying it cannot help) but never claim it completed here.
        print(f"WORKER: stale lease for {voice_id} (task={task_name}) - transcript NOT saved by this attempt; "
              f"a newer attempt owns the job", flush=True)
        return 200, {"ok": True, "skipped": True, "stale_lease": True}

    # HTTP error, unreachable database, or an unreadable answer: we do NOT know
    # the transcript was saved, so this is never acknowledged as done. Release
    # the lease (non-terminal, so the job goes back to pending for a retry) -
    # safe even if the save secretly succeeded, because fail_transcription_job
    # only touches a row still 'processing' under this lease.
    what = "malformed response" if saved is MALFORMED else f"status={status} body={type(saved).__name__}"
    released, how = release_lease(voice_id, lease_token, f"complete_transcription_job failed: {what}", False)
    print(f"WORKER: complete_transcription_job FAILED for {voice_id} (task={task_name}): {what} | {how}", flush=True)
    return 500, {"error": "could not confirm the transcript was saved", "released": released}


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
        if not voice_id:
            return self.reply(400, {"error": "voice_id required"})
        task_name = self.headers.get("X-Cloudtasks-Taskname", "")
        retry_count = int(self.headers.get("X-Cloudtasks-Taskretrycount", "0"))
        code, reply = process_job(voice_id, task_name, retry_count)
        return self.reply(code, reply)


if __name__ == "__main__":
    problems = check_config()
    if problems:
        for p in problems:
            print(f"transcription-worker: CONFIG ERROR: {p}", flush=True)
        sys.exit(1)
    print(f"transcription-worker listening on :{PORT} (environment={ENVIRONMENT})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
