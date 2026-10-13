"""ProofLab accounts: remove students completely (data + Google login).

POST /remove {"student_ids": [...]}   signed-in college or admin (bridge token)
POST /password-link {"email": ...}   functions service (x-webhook-secret): a
                                     set-password link for a new student,
                                     WITHOUT Google sending its own email, so
                                     the welcome email can carry it (one email).
POST /sync[?dry_run=1]               Cloud Scheduler (x-webhook-secret): an account of
                                     ANY role whose Google login stays deleted or
                                     disabled for SYNC_GRACE_SECONDS, confirmed by an
                                     exact lookup, has its ACCESS CUT (sessions revoked,
                                     old tickets refused; a student is also suspended) -
                                     reversible, never deleted; at most SYNC_MAX_SUSPEND
                                     per pass, an abnormal listing changes nothing, and
                                     the same login id returning restores it
                                     (sync_plan.py, migration 110). It also retries
                                     pending Google deletions (lifecycle.py).
POST /delete-account {"user_id", "confirm"}  signed-in: a college, company, recruiter
                                     or admin account deletes itself (confirm DELETE),
                                     or an administrator deletes one. Access is cut at
                                     once, records are KEPT (retention), and the Google
                                     login is deleted now or retried until Google
                                     confirms it.

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
import uuid
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import apptoken
import lifecycle
import self_delete
import sync_plan

PORT = int(os.environ.get("PORT", "8080"))
SECRET = os.environ.get("PGRST_JWT_SECRET", "").encode()
WEBHOOK = os.environ.get("WEBHOOK_SECRET", "")
POSTGREST = os.environ["POSTGREST_URL"].rstrip("/")
# The Google Identity project whose logins this service manages. IDENTITY_PROJECT names it explicitly (staging:
# its own isolated project); GCP_PROJECT is only the fallback, so moving logins never has to touch the variable other
# services read as "our infrastructure project".
PROJECT = os.environ.get("IDENTITY_PROJECT") or os.environ.get("GCP_PROJECT", "prooflab-508214")
ORIGINS = set(filter(None, os.environ.get("ALLOWED_ORIGINS", "").split(",")))
IDENTITY = f"https://identitytoolkit.googleapis.com/v1/projects/{PROJECT}"
# The exact identity scope this service acts on. Every ledger row carries it, and rows of any other scope
# are never acted on (migration 110).
TENANT = os.environ.get("IDENTITY_TENANT", "")
# Staging still pointed at PRODUCTION's login pool (shared project, no tenant) must never delete, disable or
# cut anything because of Google: it could be a real person's login. Reads (dry runs) stay possible.
SHARED_IDENTITY = PROJECT == "prooflab-508214" and not TENANT and "staging" in POSTGREST
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
    if SHARED_IDENTITY and path in ("accounts:delete", "accounts:update"):
        raise RuntimeError("staging identity is not isolated from production; Google writes refused")
    if TENANT:
        body = {**body, "tenantId": TENANT}
    return call(f"{IDENTITY}/{path}", body,
                {"Authorization": f"Bearer {google_token()}", "x-goog-user-project": PROJECT})


def scope() -> dict:
    return {"_project": PROJECT, "_tenant": TENANT}


def record_and_delete_students(rows: list, actor: str) -> list:
    """After remove_students: one outbox row per student, then one Google delete try each. A failed try is
    not lost: the row stays pending and /sync retries it with backoff. Returns the ones not finished yet."""
    payload = [{"student_id": r.get("student_id"), "provider_uid": r.get("provider_uid")} for r in rows]
    st, recorded = db("rpc/identity_record_student_removals", {"_rows": payload, "_actor": actor, **scope()})
    if st != 200 or not isinstance(recorded, list):
        # The data is already removed; without an outbox row the login would be forgotten. Loud.
        print(f"IDENTITY LIFECYCLE RECORD FAILED: {len(rows)} removed student(s) not queued ({st})", flush=True)
        return [{"error": "login deletion could not be queued"} for _ in rows]
    unfinished = []
    for row in recorded:
        result = row.get("status")
        if result in ("pending", "requested"):
            result = lifecycle.attempt(identity, db, row)
        if result != "completed":
            unfinished.append({"id": row.get("id"), "status": result or "pending"})
    return unfinished


def self_outbox(who: str, provider_uid: str | None, out: dict) -> None:
    """A student deleted themself (self_delete.py). Record the login in the outbox too, so the same retry,
    audit and alerting covers it; removed_students keeps its own record (migration 105) as before."""
    st, rows = db("rpc/identity_record_student_removals",
                  {"_rows": [{"student_id": who, "provider_uid": provider_uid}],
                   "_actor": f"self:{who}", **scope()})
    if st != 200 or not isinstance(rows, list) or not rows:
        print(f"IDENTITY LIFECYCLE RECORD FAILED: self-delete of {who} not queued ({st})", flush=True)
        return
    if out.get("login_deleted"):
        db("rpc/identity_attempt_result", {"_id": rows[0]["id"], "_deleted": True, "_error": None})


def removal_reason(role: str | None, who: str, ids: list, confirm) -> str | None:
    """Why this caller may remove these accounts, or None if they may not.

    A student may remove exactly one account, their own, and only after typing
    DELETE on the settings screen. The database checks the same rule again.
    """
    if role == "student":
        return "self" if ids == [who] and confirm == "DELETE" else None
    return {"admin": "admin", "college_admin": "college"}.get(role)


def may_still_act(who: str) -> bool | None:
    """The website's managed-login rule (web_login_identity) for this account: True, False, or None when it
    cannot be read (callers fail closed)."""
    st, out = db("rpc/web_login_identity", {"_user_id": who})
    if st != 200 or not isinstance(out, dict):
        return None
    return out.get("allowed") is True and bool(out.get("role"))


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


def all_logins(get=None) -> dict:
    """{provider_uid: disabled} for the WHOLE scoped listing. Any page error, a repeated page token or a
    runaway page count raises: an incomplete listing must never look like missing accounts."""
    get = get or (lambda url: call(url, None, {"Authorization": f"Bearer {google_token()}",
                                               "x-goog-user-project": PROJECT}, "GET"))
    logins, page, seen = {}, None, set()
    for _ in range(2000):
        url = f"{IDENTITY}/accounts:batchGet?maxResults=1000"
        if TENANT:
            url += f"&tenantId={urllib.parse.quote(TENANT)}"
        if page:
            url += f"&nextPageToken={urllib.parse.quote(page)}"
        st, out = get(url)
        if st != 200 or not isinstance(out, dict):
            raise RuntimeError(f"could not list logins: {st} {str(out)[:200]}")
        for u in out.get("users", []):
            logins[u["localId"]] = bool(u.get("disabled"))
        page = out.get("nextPageToken")
        if not page:
            return logins
        if page in seen:
            raise RuntimeError("could not list logins: the page token repeated")
        seen.add(page)
    raise RuntimeError("could not list logins: too many pages")


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
            if self.path.split("?", 1)[0] == "/sync":   # S40: /sync?dry_run=1 used to fall through to 404
                return self.sync()
            if self.path == "/password-link":
                return self.password_link()
            if self.path == "/create-user":
                return self.create_user()
            if self.path == "/delete-user":
                return self.delete_user()
            if self.path == "/delete-account":
                return self.delete_account()
            return self.reply(404, {"error": "not found"})
        except Exception as e:
            print("error:", e, flush=True)
            return self.reply(500, {"error": "Something went wrong. Nothing more was removed."})

    def remove(self):
        who = caller(self.headers.get("Authorization"))
        if not who:
            return self.reply(401, {"error": "Sign in again."})
        body = self.body()
        ids = [str(i) for i in (body.get("student_ids") or [])][:500]
        if not ids:
            return self.reply(400, {"error": "Choose at least one student."})
        st, roles = db(f"user_roles?select=role&user_id=eq.{who}", method="GET")
        role = roles[0]["role"] if st == 200 and roles else None
        reason = removal_reason(role, who, ids, body.get("confirm"))
        if not reason:
            return self.reply(403, {"error": "Only a college or an administrator can remove students."})
        if reason != "self":
            # Security gate 14 Oct (run-1 P1): the caller's role row survives a cut-off (deleted or Console-removed
            # admin, suspended or rejected college), and a ticket lives an hour. The website's own login rule decides
            # whether this account may still act. Fails closed.
            allowed = may_still_act(who)
            if allowed is None:
                return self.reply(503, {"error": "Could not check your account. Nothing was changed."})
            if not allowed:
                return self.reply(403, {"error": "Your account can no longer remove students."})
        if SHARED_IDENTITY:
            return self.reply(503, {"error": "Removing accounts is switched off here until this environment has "
                                             "its own login pool. Nothing was changed."})
        if reason == "self":
            # Its own order of steps (login disabled first), so no failure leaves a usable half-deleted account.
            st, found = db(f"account_identities?select=provider_uid&user_id=eq.{who}", method="GET")
            provider_uid = found[0].get("provider_uid") if st == 200 and isinstance(found, list) and found else None
            st, out = self_delete.run(who, identity, db, time.sleep)
            if st == 200 and out.get("removed"):
                self_outbox(who, provider_uid, out)
            print(f"self-delete by {who}: status {st}, login_deleted={out.get('login_deleted')}", flush=True)
            return self.reply(st, out)
        st, rows = db("rpc/remove_students", {"_ids": ids, "_by": who, "_reason": reason})
        if st != 200:
            msg = rows.get("message") if isinstance(rows, dict) else str(rows)
            return self.reply(403 if "college" in str(msg) else 500, {"error": msg})
        unfinished = record_and_delete_students(rows, f"{reason}:{who}")
        print(f"remove by {who} ({reason}): {len(rows)} students, {len(unfinished)} login deletes pending", flush=True)
        # login_failures keeps its meaning for the screens: logins not deleted YET (they are retried by /sync).
        return self.reply(200, {"removed": len(rows), "login_failures": unfinished, "login_pending": len(unfinished)})

    def delete_account(self):
        """A non-student account is deleted: by itself (confirm DELETE) or by an administrator. Who may delete
        whom is decided in the database (identity_request_deletion): never a protected account, never the last
        active admin, never a student (they go through /remove). Records and organisations are kept."""
        who = caller(self.headers.get("Authorization"))
        if not who:
            return self.reply(401, {"error": "Sign in again."})
        if SHARED_IDENTITY:
            return self.reply(503, {"error": "Deleting accounts is switched off here until this environment has "
                                             "its own login pool. Nothing was changed."})
        body = self.body()
        target = str(body.get("user_id") or who)
        try:
            uuid.UUID(target)
        except Exception:
            return self.reply(400, {"error": "valid user_id required"})
        st, req = db("rpc/identity_request_deletion",
                     {"_target": target, "_by": who, "_confirm": body.get("confirm"), **scope()})
        if st != 200 or not isinstance(req, dict) or "id" not in req:
            hint = req.get("hint") if isinstance(req, dict) else None
            code = {"forbidden": 403, "protected_account": 403, "last_admin": 409, "use_remove": 409,
                    "not_found": 404}.get(hint, 500)
            msg = req.get("message") if isinstance(req, dict) and code != 500 else "Nothing was changed."
            return self.reply(code, {"error": msg})
        result = req.get("status")
        if result in ("requested", "pending"):
            # Access is already cut in the database. Disabling the Google login as well stops new Google
            # sign-ins even before the delete succeeds; a failed disable is not fatal (the database refuses).
            lifecycle.disable_login(identity, str(req["provider_uid"]))
            result = lifecycle.attempt(identity, db, {"id": req["id"], "provider_uid": req["provider_uid"]}) or "pending"
        print(f"delete-account {target} by {who}: {result}", flush=True)
        return self.reply(200, {"status": result, "login_deleted": result == "completed", "records_kept": True})

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


    def delete_user(self):
        """Rollback a newly-created managed login safely.

        Internal callers only. The database account must still be empty:
        no role, student, college, company or recruiter record may exist.

        We capture the Identity record first, delete the empty DB shell,
        then delete the Identity login. If the Identity deletion fails,
        record_account restores the DB shell so we do not silently leave
        an Identity-only orphan.
        """
        if not WEBHOOK or not hmac.compare_digest(
            self.headers.get("x-webhook-secret", ""),
            WEBHOOK,
        ):
            return self.reply(401, {"error": "unauthorized"})

        user_id = str(self.body().get("user_id") or "").strip()

        try:
            uuid.UUID(user_id)
        except Exception:
            return self.reply(400, {"error": "valid user_id required"})

        st, mappings = db(
            f"account_identities?select=provider_uid&user_id=eq.{user_id}",
            method="GET",
        )

        if (
            st != 200
            or not isinstance(mappings, list)
            or len(mappings) != 1
            or not mappings[0].get("provider_uid")
        ):
            return self.reply(
                404,
                {"error": "managed account mapping not found"},
            )

        provider_uid = str(mappings[0]["provider_uid"])

        # Capture enough information to restore the DB shell if Google's
        # delete fails after drop_empty_account has removed it.
        lst, lookup = identity(
            "accounts:lookup",
            {"localId": [provider_uid]},
        )

        users = (lookup or {}).get("users") or [] if lst == 200 else []

        if len(users) != 1:
            return self.reply(
                502,
                {"error": "could not verify managed Identity login"},
            )

        snap = users[0]
        email = str(snap.get("email") or "").strip().lower()
        full_name = str(snap.get("displayName") or "").strip()
        vouched = snap.get("emailVerified") is True

        if not email:
            return self.reply(
                502,
                {"error": "managed Identity login has no email"},
            )

        dst, dropped = db(
            "rpc/drop_empty_account",
            {"_id": user_id},
        )

        if dst != 200 or dropped is not True:
            return self.reply(
                409,
                {
                    "error":
                        "account is no longer empty; refusing login rollback"
                },
            )

        ist, iout = identity(
            "accounts:delete",
            {"localId": provider_uid},
        )

        if ist == 200 or "USER_NOT_FOUND" in json.dumps(iout or {}):
            return self.reply(200, {"deleted": True})

        # Restore the DB shell because the Identity login still exists.
        rst, restored = db(
            "rpc/record_account",
            {
                "_provider_uid": provider_uid,
                "_email": email,
                "_full_name": full_name or None,
                "_vouched": vouched,
            },
        )

        if rst != 200 or not restored:
            print(
                "CRITICAL: managed Identity delete failed and "
                "database-shell restore also failed: "
                f"identity={ist} db={rst}",
                flush=True,
            )

        return self.reply(
            502,
            {
                "error":
                    "Identity login rollback failed; database shell restored"
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
            # Staging must land on staging: a college invited there has no account in production.
            "continueUrl": os.environ.get("SITE_URL", "https://prooflab.co.in").rstrip("/") + "/auth",
        })
        if st != 200 or not out.get("oobLink"):
            return self.reply(502, {"error": str(out)[:200]})
        return self.reply(200, {"link": out["oobLink"]})

    def sync(self):
        if not WEBHOOK or not hmac.compare_digest(self.headers.get("x-webhook-secret", ""), WEBHOOK):
            return self.reply(401, {"error": "unauthorized"})
        # A shared (not isolated) identity pool only ever gets a dry run: reads, no changes.
        dry_run = "dry_run=1" in (self.path.split("?", 1)[1] if "?" in self.path else "") or SHARED_IDENTITY
        if not dry_run:
            # Finish Google deletions that failed earlier: the outbox (all roles, migration 110), then any
            # self-deletion recorded before 110 (migration 105).
            try:
                print("identity outbox retry:", json.dumps(lifecycle.process_due(identity, db, PROJECT, TENANT)),
                      flush=True)
                print("self-delete retry:", json.dumps(self_delete.retry_pending(identity, db)), flush=True)
            except Exception as e:
                print("IDENTITY LIFECYCLE RETRY FAILED:", type(e).__name__, flush=True)
        try:
            logins = all_logins()
        except Exception as e:
            # Distinct line the alert policy matches. An incomplete listing changes nothing.
            print(f"ACCOUNT SYNC ABORTED: {str(e)[:200]}", flush=True)
            return self.reply(502, {"error": "could not list Google logins; nothing changed"})
        st, accounts = db("rpc/identity_sync_accounts", scope())
        if st != 200 or not isinstance(accounts, list):
            return self.reply(500, {"error": "could not list accounts"})
        decision = sync_plan.plan(accounts, logins, datetime.now(timezone.utc), LIMITS)
        summary = {"accounts": len(accounts), "logins": len(logins), "missing_now": len(decision["missing"]),
                   "newly_missing": len(decision["mark"]), "to_verify": len(decision["verify"]),
                   "came_back": len(decision["recover"]), "to_link": len(decision["link"]),
                   "unlinked_ignored": sum(1 for a in accounts if not a.get("linked")) - len(decision["link"]),
                   "shared_identity": SHARED_IDENTITY}
        if decision["abort"]:
            print(f"ACCOUNT SYNC ABORTED: {decision['abort']} {json.dumps(summary)}", flush=True)
            return self.reply(409, {"error": decision["abort"], **summary})
        if decision["review"]:
            print(f"ACCOUNT SYNC NEEDS REVIEW: {decision['review']} {json.dumps(summary)}", flush=True)
        # Independent confirmation: an exact lookup of each candidate's own id, in this scope.
        verified, unsure = [], 0
        for a in decision["verify"]:
            seen = lifecycle.lookup(identity, a["provider_uid"])
            if seen in ("absent", "disabled"):
                verified.append({"user_id": a["user_id"], "provider_uid": a["provider_uid"],
                                 "reason": "login deleted" if seen == "absent" else "login disabled"})
            elif seen == "unknown":
                unsure += 1
        if unsure:
            print(f"ACCOUNT SYNC LOOKUP FAILED: {unsure} login(s) could not be confirmed; left unchanged", flush=True)
        if dry_run:
            return self.reply(200, {"dry_run": True, **summary, "review": decision["review"],
                                    "would_cut": [v["user_id"] for v in verified],
                                    "would_restore": [a["user_id"] for a in decision["recover"]]})

        def slim(rows):
            return [{"user_id": a["user_id"], "provider_uid": a["provider_uid"], "role": a.get("role")} for a in rows]

        if decision["mark"] or verified or decision["recover"]:
            st, applied = db("rpc/identity_sync_apply", {**scope(), "_mark": slim(decision["mark"]),
                                                         "_verified": verified, "_recover": slim(decision["recover"])})
        else:   # nothing to record: no database write at all
            st, applied = 200, {"marked": 0, "verified": 0, "suspended": 0, "recovered": 0, "restored": 0, "skipped": 0}
        if st != 200 or not isinstance(applied, dict):
            print(f"ACCOUNT SYNC FAILED: the pass could not be recorded ({st}); nothing changed", flush=True)
            return self.reply(500, {"error": f"apply failed: {str(applied)[:200]}", **summary})
        if decision["link"]:
            st, linked = db("rpc/identity_link_present", {"_rows": slim(decision["link"])})
            applied["linked"] = linked if st == 200 else 0
            if st != 200:
                print(f"ACCOUNT SYNC FAILED: could not link {len(decision['link'])} present login(s) ({st})", flush=True)
        if applied.get("verified"):
            print(f"ACCOUNT SYNC SUSPENDED: access cut for {applied['verified']} account(s) whose login stayed "
                  f"missing {LIMITS.grace_seconds // 60}+ min {json.dumps(summary)}", flush=True)
        st, health = db("rpc/identity_lifecycle_health", {})
        if st == 200 and isinstance(health, dict) and (health.get("pending_over_1h") or health.get("failed")):
            print(f"IDENTITY LIFECYCLE STALE: {json.dumps(health)}", flush=True)
        return self.reply(200, {**applied, "review": decision["review"], **summary})

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
