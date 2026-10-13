"""python accounts/test_server_identity.py - exits non-zero on failure. Drives the real request handlers of
server.py with stand-ins for Google and the database: no network, no real account is touched."""
import importlib
import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone

os.environ.update({"POSTGREST_URL": "http://db.test", "WEBHOOK_SECRET": "hook", "GCP_PROJECT": "proj-iso"})
import server  # noqa: E402

NOW = datetime.now(timezone.utc)


def handler(path, body=None, headers=None):
    h = object.__new__(server.Handler)
    h.path, h.headers, h.out = path, {"x-webhook-secret": "hook", **(headers or {})}, None
    raw = json.dumps(body or {}).encode()
    h.headers["Content-Length"] = str(len(raw))
    h.rfile = io.BytesIO(raw)
    h.reply = lambda code, b: setattr(h, "out", (code, b))
    return h


class Fake:
    """The database side of one sync pass: records every RPC."""

    def __init__(self, accounts, apply_answer=None):
        self.accounts, self.calls = accounts, []
        self.apply_answer = apply_answer or {"marked": 0, "verified": 0}

    def __call__(self, path, body=None, method="POST", prefer=None):
        self.calls.append((path, body))
        if path == "rpc/identity_due_deletions":
            return 200, []
        if path.startswith("removed_students"):
            return 200, []
        if path == "rpc/identity_sync_accounts":
            assert body["_tenant"] == "" and body["_project"] in ("proj-iso", "prooflab-508214"), body
            return 200, self.accounts
        if path == "rpc/identity_sync_apply":
            return 200, self.apply_answer
        if path == "rpc/identity_link_present":
            return 200, len(body["_rows"])
        if path == "rpc/identity_lifecycle_health":
            return 200, {"pending_over_1h": 0, "failed": 0}
        raise AssertionError(path)

    def sent(self, path):
        return [b for p, b in self.calls if p == path]

    def verified(self):
        """What this pass asked the database to cut ([] when it wrote nothing at all)."""
        applied = self.sent("rpc/identity_sync_apply")
        return applied[0]["_verified"] if applied else []


def acct(i, role, status=None, minutes=40):
    return {"user_id": f"u{i}", "role": role, "provider_uid": f"p{i}", "linked": True, "protected": False,
            "ledger_status": status, "in_app_deletion": False,
            "first_missing_at": (NOW - timedelta(minutes=minutes)).isoformat() if status else None}


def run_sync(accounts, logins, google, path="/sync"):
    db = Fake(accounts)
    server.db, server.identity, server.all_logins = db, google, lambda: logins
    h = handler(path)
    h.sync()
    return h.out, db


ROLES = ["student", "college_admin", "startup", "recruiter", "admin"]
accounts = [acct(i, r) for i, r in enumerate(ROLES)] + [acct(10 + i, r) for i, r in enumerate(ROLES)]
logins = {a["provider_uid"]: False for a in accounts}


def google_absent(path, body):
    if path == "accounts:lookup":
        return 200, {}
    raise AssertionError(path)


# 1. Unauthorised scheduler call: nothing at all.
server.db = Fake([])
h = handler("/sync", headers={"x-webhook-secret": "wrong"}); h.sync()
assert h.out[0] == 401 and server.db.calls == []

# 2. Listing failure (5xx, truncated page) -> 502, the database is never asked to change anything.
def broken():
    raise RuntimeError("could not list logins: 503")
server.db, server.all_logins = Fake(accounts), broken
h = handler("/sync"); h.sync()
assert h.out[0] == 502 and not server.db.sent("rpc/identity_sync_apply"), h.out

# 3. First sighting for every role -> marked, nobody cut.
missing = {f"p{i}" for i in range(5)}
out, db = run_sync(accounts, {k: v for k, v in logins.items() if k not in missing}, google_absent)
assert out[0] == 200, out
apply = db.sent("rpc/identity_sync_apply")[0]
assert sorted(m["role"] for m in apply["_mark"]) == sorted(ROLES) and apply["_verified"] == [], apply

# 4. Past the grace, exact lookup confirms -> verified (cut), within the ceiling of 3.
due = [acct(i, r, "observed_missing") if i < 3 else acct(i, r) for i, r in enumerate(ROLES)]
out, db = run_sync(due, {k: v for k, v in logins.items() if k not in {"p0", "p1", "p2"}}, google_absent)
apply = db.sent("rpc/identity_sync_apply")[0]
assert [v["user_id"] for v in apply["_verified"]] == ["u0", "u1", "u2"], apply
assert all(v["reason"] == "login deleted" for v in apply["_verified"])

# 5. Lookup cannot answer (403 / 429 / 5xx) -> NOT cut; the listing alone is never enough.
for bad in [(403, {}), (429, {}), (500, {})]:
    out, db = run_sync(due, {k: v for k, v in logins.items() if k not in {"p0", "p1", "p2"}},
                       lambda p, b, bad=bad: bad)
    assert db.verified() == [], bad

# 6. Lookup finds the login after all (listing glitch) -> NOT cut.
out, db = run_sync(due, {k: v for k, v in logins.items() if k not in {"p0", "p1", "p2"}},
                   lambda p, b: (200, {"users": [{"localId": b["localId"][0]}]}))
assert db.verified() == []

# 7. Disabled in the Console -> cut with reason "login disabled".
out, db = run_sync([acct(0, "admin", "observed_missing")], {"p0": True, **{f"x{i}": False for i in range(30)}},
                   lambda p, b: (200, {"users": [{"localId": "p0", "disabled": True}]}))
assert db.sent("rpc/identity_sync_apply")[0]["_verified"][0]["reason"] == "login disabled"

# 8. Dry run: lookups allowed, nothing applied.
out, db = run_sync(due, {k: v for k, v in logins.items() if k not in {"p0", "p1", "p2"}}, google_absent,
                   path="/sync?dry_run=1")
assert out[1]["dry_run"] and out[1]["would_cut"] == ["u0", "u1", "u2"] and not db.sent("rpc/identity_sync_apply")

# 9. Abnormal drop -> 409, nothing applied.
many = [acct(100 + i, ROLES[i % 5]) for i in range(40)]
out, db = run_sync(many, {"zz": False}, google_absent)
assert out[0] == 409 and not db.sent("rpc/identity_sync_apply"), out

# 10. Paging: complete listing merges pages; a repeated token or an error mid-way raises (never partial).
pages = {None: (200, {"users": [{"localId": "a"}], "nextPageToken": "t1"}),
         "t1": (200, {"users": [{"localId": "b", "disabled": True}]})}
def pager(pages):
    return lambda url: pages["t1" if "nextPageToken=t1" in url else None]
assert server.all_logins.__name__ == "<lambda>"
server_mod = importlib.reload(server)
assert server_mod.all_logins(pager(pages)) == {"a": False, "b": True}
loop = {None: pages[None], "t1": (200, {"users": [], "nextPageToken": "t1"})}
try:
    server_mod.all_logins(pager(loop)); raise SystemExit("repeated page token not refused")
except RuntimeError as e:
    assert "repeated" in str(e)
err = {None: pages[None], "t1": (500, {})}
try:
    server_mod.all_logins(pager(err)); raise SystemExit("page error not refused")
except RuntimeError:
    pass

# 11. Shared production pool on staging: every Google write refused, sync forced to dry run, removal refused.
os.environ.update({"GCP_PROJECT": "prooflab-508214", "POSTGREST_URL": "https://prooflab-staging-api.test"})
shared = importlib.reload(server)
assert shared.SHARED_IDENTITY
for p in ("accounts:delete", "accounts:update"):
    try:
        shared.identity(p, {"localId": "x"}); raise SystemExit(f"{p} allowed on a shared pool")
    except RuntimeError:
        pass
db = Fake(due); shared.db, shared.all_logins = db, lambda: {k: v for k, v in logins.items() if k not in {"p0"}}
shared.identity = google_absent
h = handler("/sync"); h.sync()
assert h.out[1].get("dry_run") and not db.sent("rpc/identity_sync_apply") and not db.sent("rpc/identity_due_deletions")
shared.caller = lambda auth: "11111111-1111-1111-1111-111111111111"
h = handler("/delete-account", {"confirm": "DELETE"}); h.delete_account()
assert h.out[0] == 503, h.out
# Production itself (same project, production API) is NOT the shared case.
os.environ.update({"POSTGREST_URL": "https://prooflab-api.test"})
assert not importlib.reload(server).SHARED_IDENTITY
# IDENTITY_PROJECT names the login project; GCP_PROJECT (infrastructure) is only the fallback. Staging pointed at
# its own login project is NOT the shared case, even though GCP_PROJECT stays prooflab-508214.
os.environ.update({"IDENTITY_PROJECT": "prooflab-stg-identity-508214"})
iso = importlib.reload(server)
assert iso.PROJECT == "prooflab-stg-identity-508214" and not iso.SHARED_IDENTITY
assert iso.IDENTITY.endswith("/projects/prooflab-stg-identity-508214") and iso.scope()["_project"] == iso.PROJECT
os.environ.pop("IDENTITY_PROJECT")
# A tenant isolates: tenantId goes on every call.
os.environ.update({"IDENTITY_TENANT": "staging-t1", "POSTGREST_URL": "https://prooflab-staging-api.test"})
t = importlib.reload(server)
assert not t.SHARED_IDENTITY
sent = []
t.call = lambda url, body=None, headers=None, method="POST": sent.append((url, body)) or (200, {})
t.google_token = lambda: "tok"
t.identity("accounts:lookup", {"localId": ["x"]})
assert sent[0][1]["tenantId"] == "staging-t1"
t.all_logins()
assert "tenantId=staging-t1" in sent[1][0]
os.environ.pop("IDENTITY_TENANT")
os.environ.update({"GCP_PROJECT": "proj-iso", "POSTGREST_URL": "http://db.test"})
s = importlib.reload(server)

# 12. /delete-account: database decides; refusals map to clear codes, nothing reaches Google.
class DelDb:
    def __init__(self, answer):
        self.answer, self.calls = answer, []
    def __call__(self, path, body=None, method="POST", prefer=None):
        self.calls.append(path)
        if path == "rpc/identity_request_deletion":
            return self.answer
        if path == "rpc/identity_attempt_result":
            return 200, "completed" if body["_deleted"] else "pending"
        raise AssertionError(path)
touched = []
s.identity = lambda p, b: touched.append(p) or (200, {})
s.caller = lambda auth: "11111111-1111-1111-1111-111111111111"
for hint, code in [("forbidden", 403), ("protected_account", 403), ("last_admin", 409), ("use_remove", 409),
                   ("not_found", 404)]:
    s.db = DelDb((400, {"message": "no", "hint": hint}))
    h = handler("/delete-account", {"confirm": "DELETE"}); h.delete_account()
    assert h.out[0] == code and touched == [], (hint, h.out)
s.db = DelDb((200, {"id": 5, "provider_uid": "g-1", "status": "requested", "role": "startup"}))
h = handler("/delete-account", {"confirm": "DELETE"}); h.delete_account()
assert h.out == (200, {"status": "completed", "login_deleted": True, "records_kept": True}), h.out
assert touched == ["accounts:update", "accounts:delete"], touched   # disabled first, then deleted
touched.clear()
s.identity = lambda p, b: touched.append(p) or ((503, {}) if p == "accounts:delete" else (200, {}))
h = handler("/delete-account", {"confirm": "DELETE"}); h.delete_account()
assert h.out[1]["status"] == "pending" and h.out[1]["login_deleted"] is False, h.out   # pending is never "done"
s.db = DelDb((200, {"id": 5, "provider_uid": "g-1", "status": "completed", "already": True}))
touched.clear(); h = handler("/delete-account", {"confirm": "DELETE"}); h.delete_account()
assert h.out[1]["status"] == "completed" and touched == [], "a finished deletion is not repeated"
s.caller = lambda auth: None
h = handler("/delete-account", {"confirm": "DELETE"}); h.delete_account()
assert h.out[0] == 401

# 13. College/admin removal: every removed student gets an outbox row; a failed delete is reported pending.
class RemDb:
    def __init__(self, login=(200, {"allowed": True, "role": "college_admin"})):
        self.calls, self.login = [], login
    def __call__(self, path, body=None, method="POST", prefer=None):
        self.calls.append((path, body))
        if path.startswith("user_roles"):
            return 200, [{"role": "college_admin"}]
        if path == "rpc/web_login_identity":
            return self.login
        if path == "rpc/remove_students":
            return 200, [{"student_id": "s1", "provider_uid": "g1", "email": "a@x"},
                         {"student_id": "s2", "provider_uid": "g2", "email": "b@x"}]
        if path == "rpc/identity_record_student_removals":
            return 200, [{"id": 1, "user_id": "s1", "provider_uid": "g1", "status": "pending"},
                         {"id": 2, "user_id": "s2", "provider_uid": "g2", "status": "pending"}]
        if path == "rpc/identity_attempt_result":
            return 200, "completed" if body["_deleted"] else "pending"
        raise AssertionError(path)
s.db, s.caller = RemDb(), (lambda auth: "c0ffee00-0000-0000-0000-000000000001")
s.identity = lambda p, b: (200, {}) if b["localId"] == "g1" else (500, {})
h = handler("/remove", {"student_ids": ["s1", "s2"]}); h.remove()
assert h.out[0] == 200 and h.out[1]["removed"] == 2 and h.out[1]["login_pending"] == 1, h.out
rec = [b for p, b in s.db.calls if p == "rpc/identity_record_student_removals"][0]
assert rec["_actor"].startswith("college:") and rec["_project"] == "proj-iso", rec

# 14. Security gate 14 Oct: a college/admin whose account may no longer act (cut-off admin, suspended or rejected
#     college) is refused BEFORE remove_students; an unreadable rule fails closed. The allowed case is test 13.
for login, code in [((200, {"allowed": False, "reason": "college_account_unavailable"}), 403),
                    ((200, {"allowed": False, "reason": "identity_missing"}), 403),
                    ((200, {"allowed": True}), 403),
                    ((500, {"message": "boom"}), 503),
                    ((200, ["not", "an", "object"]), 503)]:
    s.db = RemDb(login)
    h = handler("/remove", {"student_ids": ["s1"]}); h.remove()
    assert h.out[0] == code, (login, h.out)
    asked = [p for p, b in s.db.calls]
    assert "rpc/remove_students" not in asked and "rpc/identity_record_student_removals" not in asked, asked
    assert [b for p, b in s.db.calls if p == "rpc/web_login_identity"][0] == {"_user_id": "c0ffee00-0000-0000-0000-000000000001"}

# 15. 13 Oct staging: set-password links open ProofLab's own page (SITE_URL/reset-password) with the same one-time
#     code. Google's hosted page needs a Firebase web setup the isolated staging pool does not have.
os.environ["SITE_URL"] = "https://prooflab-staging.web.app"
s.link_refusal = lambda email: None
s.identity = lambda p, b: (200, {"oobLink": "https://pool.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=ABC-123_x&apiKey=k&lang=en"})
h = handler("/password-link", {"email": "new@x.test"}); h.password_link()
assert h.out == (200, {"link": "https://prooflab-staging.web.app/reset-password?mode=resetPassword&oobCode=ABC-123_x"}), h.out
s.identity = lambda p, b: (200, {"oobLink": "https://pool.firebaseapp.com/__/auth/action?mode=resetPassword"})
h = handler("/password-link", {"email": "new@x.test"}); h.password_link()
assert h.out[1]["link"].startswith("https://pool.firebaseapp.com/"), "a link without a code is kept as Google sent it"
s.link_refusal = lambda email: "login is not newly created"
h = handler("/password-link", {"email": "old@x.test"}); h.password_link()
assert h.out[0] == 403, "control: an old login still gets no link"

print("server identity lifecycle: all checks passed")
