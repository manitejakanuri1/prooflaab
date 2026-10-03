"""ProofLab transcriber: POST /transcribe (raw audio body) -> {text, segments, duration}.

Speech to text for the 60-second explanation and the mock interview, done on
the server so it works the same on a cheap phone and a laptop: the device only
records and uploads. Settings follow VoxScript AI's working CPU pipeline:
faster-whisper "base", int8, silence skipped (vad_filter), beam size 1.

Only a signed-in user can call it: the same HS256 token the auth bridge issues
and the database and file service already accept.
"""
import base64
import apptoken
import hashlib
import hmac
import json
import os
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from faster_whisper import WhisperModel

PORT = int(os.environ.get("PORT", "8080"))
SECRET = os.environ.get("PGRST_JWT_SECRET", "").encode()
ORIGINS = set(filter(None, os.environ.get("ALLOWED_ORIGINS", "").split(",")))
MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")
MAX_BYTES = 15 * 1024 * 1024  # a 60-90 s recording is well under 2 MB

# Loaded once per instance, from the copy baked into the image at build time.
MODEL = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8",
                     cpu_threads=os.cpu_count() or 2, download_root="/models")


def b64url(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def caller(auth: str | None) -> str | None:
    """Who is asking: a signed-in user's id, or "service" for another backend service
    (the transcription worker). Verified by apptoken (RS256; legacy HS256 only while
    that secret is still configured). None means refuse."""
    return apptoken.user_id(auth) or ("service" if apptoken.is_service(auth) else None)


def transcribe(path: str) -> dict:
    segments, info = MODEL.transcribe(path, language="en", vad_filter=True, beam_size=1, best_of=1)
    out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
           for s in segments if s.text.strip()]
    return {"text": " ".join(s["text"] for s in out), "segments": out, "duration": round(info.duration, 2)}


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Max-Age", "3600")

    def reply(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        self.reply(200 if self.path == "/ready" else 404, {"ok": self.path == "/ready", "model": MODEL_NAME})

    def do_POST(self):
        if self.path != "/transcribe":
            return self.reply(404, {"error": "not found"})
        if not caller(self.headers.get("Authorization")):
            return self.reply(401, {"error": "Sign in again to save your recording."})
        size = int(self.headers.get("Content-Length") or 0)
        if size <= 0 or size > MAX_BYTES:
            return self.reply(413, {"error": "The recording is empty or too large."})
        kind = (self.headers.get("Content-Type") or "").split(";")[0]
        suffix = ".m4a" if kind == "audio/mp4" else ".wav" if kind in ("audio/wav", "audio/x-wav") else ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
            tmp.write(self.rfile.read(size))
            tmp.flush()
            try:
                return self.reply(200, transcribe(tmp.name))
            except Exception as e:  # unreadable audio, not a server fault worth a 500 page
                return self.reply(422, {"error": f"Could not read this recording: {str(e)[:200]}"})

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
