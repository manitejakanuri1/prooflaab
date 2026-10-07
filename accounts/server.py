"""ProofLab accounts: remove students completely (data + Google login).

POST /remove {"student_ids": [...]}   signed-in college or admin (bridge token)
POST /password-link {"email": ...}   functions service (x-webhook-secret): a
                                     set-password link for a new student,
                                     WITHOUT Google sending its own email, so
                                     the welcome email can carry it (one email).
POST /sync[?dry_run=1]               Cloud Scheduler (x-webhook-secret): a
                                     student whose Google login stays deleted for
                                     SYNC_GRACE_SECONDS is SUSPENDED (reversible),
                                     never deleted; at most SYNC_MAX_SUSPEND per pass,
                                     an abnormal listing changes nothing, and a
                                     returning login restores them (sync_plan.py).

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
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import apptoken
import sync_plan

PORT = int(os.environ.get("PORT", "8080"))
SECRET = os.environ.get("PGRST_JWT_SECRET", "").encode()
WEBHOOK = os.environ.get("WEBHOOK_SECRET", "")
POSTGREST = os.environ["POSTGREST_URL"].rstrip("/")
PROJECT = os.environ.get("GCP_PROJECT", "prooflab-508214")
ORIGINS = set(filter(None, os.environ.get("ALLOWED_ORIGINS", "").split(",")))
IDENTITY = f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}"
# Account-sync safety (sync_plan.py). Configuration, not magic numbers: the job only
# ever SUSPENDS (reversibly) and never deletes; see sync_plan.Limits for meanings.
LIMITS = sync_plan.Limits(
    grace_seconds=int(os.environ.get("SYNC_GRACE_SECONDS", 30 * 60)),
    abnormal_abs=int(os.environ.get("SYNC_ABNORMAL_ABS", 25)),
    abnormal_fraction=float(os.environ.get("SYNC_ABNORMAL_FRACTION", 0.05)),
    max_suspend=int(os.environ.get("SYNC_MAX_SUSPEND", 3)),
)
# A set-password link is only returned for a login created this recently (an import in progress).
LINK_MAX_AGE_SECONDS = 3600


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def caller(auth: str | None) -> str | None:
    """The signed-in user id from a bridge token, or None (apptoken: RS256, or legacy HS256
    only while that secret is still configured)."""
    return apptoken.user_id(auth)


def service_token() -> str:
    """From the signer when SIGNER_URL is set (this service's own identity), else legacy."""
    return apptoken.service_token()


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


def db(path: str, body=None, method="POST", prefer: str | None = None):
    headers = {"Authorization": f"Bearer {service_token()}"}
    if prefer:
        headers["Prefer"] = prefer
    return call(f"{POSTGREST}/{path}", body, headers, method)


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


def link_refusal(email: str) -> str | None:
    """Why a set-password link must not be returned for this email, or None if it may."""
    st, out = identity("accounts:lookup", {"email": [email]})
    users = (out or {}).get("users") or [] if st == 200 else []
    if not users:
        return "no such login"
    created_ms = int(users[0].get("createdAt") or 0)
    if time.time() * 1000 - created_ms > LINK_MAX_AGE_SECONDS * 1000:
        return "login is not newly created"
    st, uid = db("rpc/account_id_for_email", {"_email": email.lower()})
    if st != 200 or not uid:
        return "login has no account record"
    st, roles = db(f"user_roles?select=role&user_id=eq.{uid}", method="GET")
    if st != 200 or any(r.get("role") == "admin" for r in roles or []):
        return "not available for this account"
    return None


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
            if self.path == "/password-link":
                return self.password_link()
            if self.path == "/create-user":
                return self.create_user()
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

    def create_user(self):
        """Create a managed Identity Platform account.

        Only trusted server code holding WEBHOOK_SECRET may call this.
        Identity creation uses this service account's Google OAuth credential,
        not the browser API-key signup path. The database account record is
        written before success is returned. If that write fails, the fresh
        Identity login is deleted again so no orphan login is left behind.
        """
        if not WEBHOOK or not hmac.compare_digest(
            self.headers.get("x-webhook-secret", ""),
            WEBHOOK,
        ):
            return self.reply(401, {"error": "unauthorized"})

        body = self.body()
        email = str(body.get("email") or "").strip().lower()
        password = str(body.get("password") or "")
        full_name = str(body.get("full_name") or "").strip()
        vouched = body.get("email_confirm") is True

        if (
            "@" not in email
            or len(email) > 255
            or len(password) < 6
            or len(password) > 4096
            or len(full_name) > 200
        ):
            return self.reply(400, {"error": "invalid managed account details"})

        # Admin-authenticated project endpoint. Unlike /v1/accounts:signUp
        # with only a browser API key, this call requires this Cloud Run
        # service account's Identity Platform IAM permission.
        st, created = identity("accounts", {
            "email": email,
            "password": password,
            "displayName": full_name,
            "emailVerified": vouched,
            "disabled": False,
        })

        if st != 200:
            raw = json.dumps(created or {})
            if "EMAIL_EXISTS" in raw:
                return self.reply(
                    409,
                    {"error": "An account with this email already exists"},
                )
            print(
                f"managed Identity create failed: HTTP {st} {raw[:200]}",
                flush=True,
            )
            return self.reply(
                502,
                {"error": "Identity Platform account creation failed"},
            )

        provider_uid = str((created or {}).get("localId") or "")
        created_email = str((created or {}).get("email") or email)

        if not provider_uid:
            return self.reply(
                502,
                {"error": "Identity Platform returned no user id"},
            )

        st, account_id = db(
            "rpc/record_account",
            {
                "_provider_uid": provider_uid,
                "_email": created_email,
                "_full_name": full_name or None,
                "_vouched": vouched,
            },
        )

        if st != 200 or not account_id:
            # Compensating rollback: never leave an Identity-only login behind.
            dst, dout = identity(
                "accounts:delete",
                {"localId": provider_uid},
            )
            if dst != 200:
                print(
                    "CRITICAL: managed account DB record failed and "
                    f"Identity cleanup failed: {dst} {str(dout)[:200]}",
                    flush=True,
                )
            return self.reply(
                502,
                {"error": "Account database record failed; login rolled back"},
            )

        return self.reply(
            200,
            {
                "user": {
                    "id": account_id,
                    "email": created_email,
                }
            },
        )

    def password_link(self):
        if not WEBHOOK or not hmac.compare_digest(self.headers.get("x-webhook-secret", ""), WEBHOOK):
            return self.reply(401, {"error": "unauthorized"})
        email = str(self.body().get("email") or "").strip()
        if "@" not in email:
            return self.reply(400, {"error": "email required"})
        # A returned link signs into the account, so it is only handed out for the
        # one case it exists for: a login created moments ago by an import or a
        # college creation. Anything older, or an admin, gets nothing here; the
        # caller then falls back to Google mailing the owner directly. Without
        # this, anyone holding the webhook secret could take over any account.
        refusal = link_refusal(email)
        if refusal:
            print(f"password-link refused: {refusal}", flush=True)
            return self.reply(403, {"error": refusal})
        # returnOobLink: Google hands the link back instead of mailing it.
        st, out = identity("accounts:sendOobCode", {
            "requestType": "PASSWORD_RESET", "email": email, "returnOobLink": True,
            "continueUrl": "https://prooflab.co.in/auth",
        })
        if st != 200 or not out.get("oobLink"):
            return self.reply(502, {"error": str(out)[:200]})
        return self.reply(200, {"link": out["oobLink"]})

    def sync(self):
        if not WEBHOOK or not hmac.compare_digest(self.headers.get("x-webhook-secret", ""), WEBHOOK):
            return self.reply(401, {"error": "unauthorized"})
        dry_run = "dry_run=1" in (self.path.split("?", 1)[1] if "?" in self.path else "")
        logins = all_login_ids()          # any listing/paging/timeout error raises -> 500, nothing changed
        st, students = db("rpc/student_logins", {})
        if st != 200:
            return self.reply(500, {"error": "could not list students"})
        st, ledger = db("account_sync_missing?select=student_id,first_missing_at,suspended_at", method="GET")
        if st != 200:
            return self.reply(500, {"error": "could not read the missing-login ledger"})
        st, prot = db("protected_test_accounts?select=user_id", method="GET")
        if st != 200:
            return self.reply(500, {"error": "could not read protected accounts"})
        decision = sync_plan.plan(students, logins, ledger, datetime.now(timezone.utc), LIMITS,
                                  protected={r["user_id"] for r in prot})
        summary = {"students": len(students), "logins": len(logins), "missing_now": len(decision["missing"]),
                   "newly_missing": len(decision["mark"]), "came_back": len(decision["clear"]),
                   "to_suspend": len(decision["suspend"]), "to_restore": len(decision["restore"])}
        if decision["abort"]:
            # Distinct log lines the alert policies match. Nothing is changed.
            print(f"ACCOUNT SYNC ABORTED: {decision['abort']} {json.dumps(summary)}", flush=True)
            return self.reply(409, {"error": decision["abort"], **summary})
        if decision["review"]:
            print(f"ACCOUNT SYNC NEEDS REVIEW: {decision['review']} {json.dumps(summary)}", flush=True)
        if dry_run:
            return self.reply(200, {"dry_run": True, **summary, "review": decision["review"],
                                    "would_suspend": decision["suspend"], "would_restore": decision["restore"]})
        if decision["mark"]:
            # ignore-duplicates keeps the FIRST time a login was seen missing.
            db("account_sync_missing?on_conflict=student_id",
               [{"student_id": s["student_id"], "provider_uid": s["provider_uid"]} for s in decision["mark"]],
               prefer="resolution=ignore-duplicates,return=minimal")
        restored = suspended = 0
        if decision["clear"]:
            st, restored = db("rpc/sync_restore_students", {"_ids": decision["clear"]})
            if st != 200:
                return self.reply(500, {"error": f"restore failed: {str(restored)[:200]}", **summary})
        if decision["suspend"]:
            st, suspended = db("rpc/sync_suspend_students", {"_ids": decision["suspend"]})
            if st != 200:
                return self.reply(500, {"error": f"suspend failed: {str(suspended)[:200]}", **summary})
            print(f"ACCOUNT SYNC SUSPENDED: {suspended} student(s) whose login stayed missing "
                  f"{LIMITS.grace_seconds // 60}+ min {json.dumps(summary)}", flush=True)
        return self.reply(200, {"suspended": suspended, "restored": restored, "review": decision["review"], **summary})

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
