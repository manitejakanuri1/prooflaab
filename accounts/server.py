"""ProofLab accounts: remove students completely (data + Google login).

POST /remove {"student_ids": [...]}   signed-in college or admin (bridge token)
POST /sync                           Cloud Scheduler (x-webhook-secret): any
                                     student whose Google login was deleted in
                                     the console is removed from ProofLab too.

A separate service because deleting a login needs Identity Platform's admin API,
which needs this service account's token from the metadata server - the
functions service cannot reach it. Who may remove whom is decided in the
database by remove_students(), which also keeps a backup row per student.
"""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8080"))
SECRET = os.environ.get("PGRST_JWT_SECRET", "").encode()
WEBHOOK = os.environ.get("WEBHOOK_SECRET", "")
POSTGREST = os.environ["POSTGREST_URL"].rstrip("/")
PROJECT = os.environ.get("GCP_PROJECT", "prooflab-508214")
ORIGINS = set(filter(None, os.environ.get("ALLOWED_ORIGINS", "").split(",")))
IDENTITY = f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def caller(auth: str | None) -> str | None:
    """The signed-in user id from a bridge token, or None."""
    if not SECRET or not auth or not auth.startswith("Bearer "):
        return None
    try:
        head, body, sig = auth[7:].split(".")
        if json.loads(unb64(head)).get("alg") != "HS256":
            return None
        if not hmac.compare_digest(hmac.new(SECRET, f"{head}.{body}".encode(), hashlib.sha256).digest(), unb64(sig)):
            return None
        claims = json.loads(unb64(body))
        if claims.get("role") != "authenticated" or float(claims.get("exp", 0)) <= time.time():
            return None
        return str(claims.get("sub") or "") or None
    except Exception:
        return None


def service_token() -> str:
    head = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64url(json.dumps({"role": "service_role", "exp": int(time.time()) + 120}).encode())
    return f"{head}.{body}." + b64url(hmac.new(SECRET, f"{head}.{body}".encode(), hashlib.sha256).digest())


def call(url: str, body=None, headers=None, method="POST"):
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), method=method,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw.decode(errors="replace")


def db(path: str, body=None, method="POST"):
    return call(f"{POSTGREST}/{path}", body, {"Authorization": f"Bearer {service_token()}"}, method)


def google_token() -> str:
    req = urllib.request.Request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        headers={"Metadata-Flavor": "Google"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())["access_token"]


def identity(path: str, body: dict):
    return call(f"{IDENTITY}/{path}", body,
                {"Authorization": f"Bearer {google_token()}", "x-goog-user-project": PROJECT})


def delete_logins(rows: list) -> list:
    """Delete each removed student's Google login. A login that is already gone is fine."""
    failed = []
    for r in rows:
        st, out = identity("accounts:delete", {"localId": r["provider_uid"]})
        if st != 200 and "USER_NOT_FOUND" not in json.dumps(out):
            failed.append({"email": r.get("email"), "error": str(out)[:200]})
    return failed


def all_login_ids() -> set:
    ids, page = set(), None
    while True:
        st, out = call(f"{IDENTITY}/accounts:batchGet?maxResults=1000" + (f"&nextPageToken={page}" if page else ""),
                       None, {"Authorization": f"Bearer {google_token()}", "x-goog-user-project": PROJECT}, "GET")
        if st != 200:
            raise RuntimeError(f"could not list logins: {st} {str(out)[:200]}")
        ids |= {u["localId"] for u in out.get("users", [])}
        page = out.get("nextPageToken")
        if not page:
            return ids


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

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
        self.reply(200 if self.path == "/ready" else 404, {"ok": self.path == "/ready"})

    def body(self) -> dict:
        size = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(size) or b"{}") if 0 < size < 100_000 else {}

    def do_POST(self):
        try:
            if self.path == "/remove":
                return self.remove()
            if self.path == "/sync":
                return self.sync()
            return self.reply(404, {"error": "not found"})
        except Exception as e:
            print("error:", e, flush=True)
            return self.reply(500, {"error": "Something went wrong. Nothing more was removed."})

    def remove(self):
        who = caller(self.headers.get("Authorization"))
        if not who:
            return self.reply(401, {"error": "Sign in again."})
        ids = [str(i) for i in (self.body().get("student_ids") or [])][:500]
        if not ids:
            return self.reply(400, {"error": "Choose at least one student."})
        st, roles = db(f"user_roles?select=role&user_id=eq.{who}", method="GET")
        role = roles[0]["role"] if st == 200 and roles else None
        reason = {"admin": "admin", "college_admin": "college"}.get(role)
        if not reason:
            return self.reply(403, {"error": "Only a college or an administrator can remove students."})
        st, rows = db("rpc/remove_students", {"_ids": ids, "_by": who, "_reason": reason})
        if st != 200:
            msg = rows.get("message") if isinstance(rows, dict) else str(rows)
            return self.reply(403 if "college" in str(msg) else 500, {"error": msg})
        failed = delete_logins(rows)
        print(f"remove by {who} ({reason}): {len(rows)} students, {len(failed)} login deletes failed", flush=True)
        return self.reply(200, {"removed": len(rows), "login_failures": failed})

    def sync(self):
        if not WEBHOOK or not hmac.compare_digest(self.headers.get("x-webhook-secret", ""), WEBHOOK):
            return self.reply(401, {"error": "unauthorized"})
        logins = all_login_ids()          # raises -> 500, nothing removed
        if not logins:
            return self.reply(409, {"error": "Identity Platform returned no logins at all; refusing to act."})
        st, students = db("rpc/student_logins", {})
        if st != 200:
            return self.reply(500, {"error": "could not list students"})
        gone = [s["student_id"] for s in students if s["provider_uid"] not in logins]
        if not gone:
            return self.reply(200, {"removed": 0})
        st, rows = db("rpc/remove_students", {"_ids": gone, "_by": None, "_reason": "console_sync"})
        if st != 200:
            return self.reply(500, {"error": str(rows)[:300]})
        print(f"console sync: removed {len(rows)} students whose login was deleted", flush=True)
        return self.reply(200, {"removed": len(rows)})

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
