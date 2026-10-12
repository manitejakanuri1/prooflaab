"""S40 fault injection for the Google Identity <-> app account sync over REAL HTTP (migration 110 design).

    python accounts/test_sync_faults.py      (exits non-zero on failure)

The real ThreadingHTTPServer + Handler of server.py run on a local port; Google and the database are fakes that
fail on demand. TEJA's test_server_identity.py calls Handler.sync() directly; this file goes through the router and
the wire, which is how S40 found that POST /sync?dry_run=1 answered 404. Also covered end to end: the staging shape
(15,004 accounts with no Google mapping, see test_sync_unmapped.py), every database step failing, a rerun of the same
pass, and that no route of the sync ever deletes anyone.
"""
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer

os.environ.setdefault("POSTGREST_URL", "http://db.invalid")
os.environ["WEBHOOK_SECRET"] = "test-webhook-secret"
os.environ.setdefault("GCP_PROJECT", "proj-iso")
import server  # noqa: E402

server.WEBHOOK = "test-webhook-secret"
NOW = datetime.now(timezone.utc)


def acct(i, role="student", status=None, minutes=45, unmapped=False):
    uid = f"00000000-0000-4000-{'9' if unmapped else '8'}000-{i:012d}"
    return {"user_id": uid, "role": role, "provider_uid": uid if unmapped else f"google-{i}", "protected": False,
            "in_app_deletion": False, "ledger_status": status,
            "first_missing_at": (NOW - timedelta(minutes=minutes)).isoformat() if status else None}


class World:
    def __init__(self, accounts, logins, lookup="absent"):
        self.accounts, self.logins, self.lookup = accounts, logins, lookup
        self.fail, self.calls, self.google = set(), [], []

    def all_logins(self):
        self.calls.append("google.list")
        if "list" in self.fail:
            raise RuntimeError("could not list logins: 503")
        return dict(self.logins)

    def identity(self, path, body):
        self.google.append(path)
        if path == "accounts:lookup":
            if self.lookup == "unknown":
                return 503, {"error": "unavailable"}
            if self.lookup == "absent":
                return 200, {}
            return 200, {"users": [{"localId": body.get("localId", [""])[0] if isinstance(body.get("localId"), list) else body.get("localId"),
                                    "disabled": self.lookup == "disabled"}]}
        raise AssertionError(f"the sync must not call Google {path}")

    def db(self, path, body=None, method="POST", prefer=None):
        self.calls.append(path.split("?")[0])
        if path == "rpc/identity_due_deletions" or path.startswith("removed_students"):
            return 200, []
        if path == "rpc/identity_sync_accounts":
            return (500, {"message": "down"}) if "accounts" in self.fail else (200, [dict(a) for a in self.accounts])
        if path == "rpc/identity_sync_apply":
            if "apply" in self.fail:
                return 500, {"message": "apply broke"}
            return 200, {"marked": len(body["_mark"]), "verified": len(body["_verified"]), "recovered": len(body["_recover"]),
                         "sent": {k: [r["user_id"] for r in body[k]] for k in ("_mark", "_verified", "_recover")}}
        if path == "rpc/identity_lifecycle_health":
            return 200, {"pending_over_1h": 0, "failed": 0}
        raise AssertionError(f"unexpected database call {path}")


class SyncOverHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def use(self, w):
        server.all_logins, server.db, server.identity = w.all_logins, w.db, w.identity
        self.addCleanup(setattr, server, "SHARED_IDENTITY", server.SHARED_IDENTITY)
        server.SHARED_IDENTITY = False
        self.w = w
        return w

    def post(self, path="/sync", secret="test-webhook-secret"):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=b"", method="POST",
                                     headers={**({"x-webhook-secret": secret} if secret else {})})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def applied(self):
        return "rpc/identity_sync_apply" in self.w.calls

    def test_no_or_wrong_secret_is_refused_on_the_wire_and_touches_nothing(self):
        w = self.use(World([acct(1)], {"google-1": False}))
        for secret in (None, "", "wrong"):
            self.assertEqual(self.post(secret=secret)[0], 401)
        self.assertEqual((w.calls, w.google), ([], []))

    def test_dry_run_over_http_reports_and_applies_nothing(self):
        gone = acct(500, "college_admin", status="observed_missing")
        w = self.use(World([acct(i) for i in range(100)] + [gone], {f"google-{i}": False for i in range(100)}))
        code, out = self.post("/sync?dry_run=1")
        self.assertEqual(code, 200, f"S40: the dry run answered {code} {out}")
        self.assertEqual((out.get("dry_run"), out.get("would_cut")), (True, [gone["user_id"]]))
        self.assertFalse(self.applied())
        self.assertNotIn("rpc/identity_due_deletions", w.calls, "a dry run does not retry Google deletions either")

    def test_unknown_paths_are_still_404_and_do_nothing(self):
        w = self.use(World([acct(1)], {"google-1": False}))
        for p in ("/sync/", "/syncx", "/sync/../remove"):
            self.assertEqual(self.post(p)[0], 404, p)
        self.assertEqual(w.calls, [])

    def test_staging_shape_end_to_end_unmapped_records_are_never_sent_to_be_cut(self):
        real = [acct(i, r) for i, r in enumerate(["student", "college_admin", "startup", "recruiter", "admin"])]
        gone = acct(7, "startup", status="observed_missing")
        seeded = [acct(i, unmapped=True, status="observed_missing" if i < 5 else None) for i in range(15004)]
        w = self.use(World(real + [gone] + seeded, {a["provider_uid"]: False for a in real}))
        code, out = self.post()
        self.assertEqual(code, 200, out)
        self.assertEqual(out["unmapped_absent"], 15004)
        self.assertEqual(out["sent"]["_verified"], [gone["user_id"]], "only the real, mapped account is cut")
        self.assertFalse(set(out["sent"]["_mark"]) & {a["user_id"] for a in seeded})
        self.assertEqual(w.google.count("accounts:lookup"), 1, "no Google lookup is spent on seeded records")

    def test_every_failure_before_apply_changes_nothing(self):
        for what in ("list", "accounts"):
            w = self.use(World([acct(1, status="observed_missing")], {"google-2": False}))
            w.fail.add(what)
            self.assertIn(self.post()[0], (500, 502), what)
            self.assertFalse(self.applied(), what)

    def test_lookup_unavailable_cuts_nobody(self):
        w = self.use(World([acct(i) for i in range(50)] + [acct(99, status="observed_missing")],
                           {f"google-{i}": False for i in range(50)}, lookup="unknown"))
        code, out = self.post()
        self.assertEqual((code, out["sent"]["_verified"]), (200, []))

    def test_apply_failure_is_reported_and_the_same_pass_twice_sends_the_same_thing(self):
        accounts = [acct(i) for i in range(50)] + [acct(99, "admin", status="observed_missing")]
        w = self.use(World(accounts, {f"google-{i}": False for i in range(50)}))
        w.fail.add("apply")
        self.assertEqual(self.post()[0], 500)
        w.fail.clear()
        first = self.post()[1]["sent"]
        second = self.post()[1]["sent"]
        self.assertEqual(first, second, "a rerun asks for the same change; the database applies it once (migration 110)")

    def test_the_sync_never_asks_google_or_the_database_to_delete_anyone(self):
        accounts = [acct(i) for i in range(50)] + [acct(99, status="observed_missing"), acct(98, status="observed_missing")]
        w = self.use(World(accounts, {f"google-{i}": False for i in range(50)}))
        self.post(); self.post("/sync?dry_run=1")
        self.assertTrue(set(w.google) <= {"accounts:lookup"}, w.google)
        self.assertFalse([c for c in w.calls if c in ("rpc/remove_students", "rpc/identity_request_deletion") or "delete" in c], w.calls)


if __name__ == "__main__":
    unittest.main(verbosity=2)
