"""S40 fault injection for the Google Identity -> app account sync (POST /sync). OFFLINE: the real HTTP handler of
server.py runs on a local port; Google Identity and the database are fakes that can fail on demand.

    python accounts/test_sync_faults.py      (exits non-zero on failure)

Covers what the pure plan test (test_sync_plan.py) cannot: authentication, the dry run, listing and paging
failures, empty and abnormal listings (the staging shape: 15,004 seeded students with no login), a rerun of the same
event, partial database failures, retries, protected accounts, and that the sync only ever touches students.
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
os.environ["SYNC_GRACE_SECONDS"] = "1800"
import server  # noqa: E402

server.WEBHOOK = "test-webhook-secret"


class World:
    """Google logins and the four tables/RPCs the sync reads and writes, with switchable failures."""

    def __init__(self, n_students=200, logins=None, protected=()):
        self.students = [{"student_id": f"s{i}", "provider_uid": f"p{i}"} for i in range(n_students)]
        self.logins = set(logins) if logins is not None else {s["provider_uid"] for s in self.students}
        self.ledger = {}            # student_id -> {first_missing_at, suspended_at}
        self.status = {s["student_id"]: "active" for s in self.students}
        self.protected = set(protected)
        self.fail = set()           # names of the calls that fail: list, students, ledger_read, mark, restore, suspend, retry
        self.calls = []
        self.pages = 1

    # ---- Google Identity
    def all_login_ids(self):
        self.calls.append("identity.list")
        if "list" in self.fail:
            raise RuntimeError("could not list logins: 503 backend error")
        return set(self.logins)

    # ---- PostgREST
    def db(self, path, body=None, method="POST", prefer=None):
        self.calls.append(f"{method} {path.split('?')[0]}")
        if path == "rpc/student_logins":
            return (500, {"message": "down"}) if "students" in self.fail else (200, [dict(s) for s in self.students])
        if path.startswith("account_sync_missing?select"):
            if "ledger_read" in self.fail:
                return 500, {"message": "down"}
            return 200, [{"student_id": k, **v} for k, v in self.ledger.items()]
        if path.startswith("protected_test_accounts"):
            return 200, [{"user_id": p} for p in self.protected]
        if path.startswith("account_sync_missing?on_conflict"):
            if "mark" in self.fail:
                return 503, {"message": "could not write"}
            assert prefer and "ignore-duplicates" in prefer, prefer
            for row in body:   # keeps the FIRST time a login was seen missing
                self.ledger.setdefault(row["student_id"], {"first_missing_at": self.now().isoformat(), "suspended_at": None})
            return 201, None
        if path == "rpc/sync_restore_students":
            if "restore" in self.fail:
                return 500, {"message": "restore broke"}
            n = 0
            for i in body["_ids"]:
                if self.status.get(i) == "suspended" and (self.ledger.get(i) or {}).get("suspended_at"):
                    self.status[i] = "active"; n += 1
                self.ledger.pop(i, None)
            return 200, n
        if path == "rpc/sync_suspend_students":
            if "suspend" in self.fail:
                return 500, {"message": "suspend broke"}
            n = 0
            for i in body["_ids"]:
                if self.status.get(i) == "active" and i not in self.protected:
                    self.status[i] = "suspended"; self.ledger[i]["suspended_at"] = self.now().isoformat(); n += 1
            return 200, n
        if path.startswith("removed_students"):   # self-delete retry (migration 105/107)
            if "retry" in self.fail:
                raise RuntimeError("retry exploded")
            return 200, []
        raise AssertionError(f"unexpected database call {method} {path}")

    clock = datetime(2026, 10, 13, 6, 0, tzinfo=timezone.utc)

    def now(self):
        return World.clock

    def age(self, minutes):
        """Every ledger row became missing `minutes` ago."""
        for v in self.ledger.values():
            v["first_missing_at"] = (self.now() - timedelta(minutes=minutes)).isoformat()


class SyncFaults(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def use(self, world):
        self.w = world
        server.all_login_ids = world.all_login_ids
        server.db = world.db
        server.identity = lambda path, body: (200, {})
        real_plan = server.sync_plan.plan
        server.sync_plan.plan = lambda s, l, led, now, *a, **k: real_plan(s, l, led, world.now(), *a, **k)
        self.addCleanup(setattr, server.sync_plan, "plan", real_plan)
        return world

    def post(self, path="/sync", secret="test-webhook-secret"):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=b"", method="POST",
                                     headers={"Content-Type": "application/json", **({"x-webhook-secret": secret} if secret else {})})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}")

    def writes(self):
        return [c for c in self.w.calls if c.startswith("POST rpc/sync_") or c.startswith("POST account_sync_missing")]

    # ---- authentication
    def test_no_or_wrong_secret_is_refused_and_touches_nothing(self):
        w = self.use(World())
        for secret in (None, "", "wrong"):
            self.assertEqual(self.post(secret=secret)[0], 401)
        self.assertEqual(w.calls, [])

    # ---- the dry run, the safe way to look before acting
    def test_dry_run_reports_and_changes_nothing(self):
        w = self.use(World(logins={f"p{i}" for i in range(200) if i != 7}))
        w.ledger["s7"] = {"first_missing_at": (w.now() - timedelta(hours=2)).isoformat(), "suspended_at": None}
        code, out = self.post("/sync?dry_run=1")
        self.assertEqual(code, 200, out)
        self.assertEqual((out.get("dry_run"), out.get("would_suspend")), (True, ["s7"]))
        self.assertEqual(self.writes(), [])
        self.assertNotIn("POST removed_students", " ".join(w.calls), "a dry run does not retry deletions either")

    # ---- Google side failures
    def test_listing_failure_changes_nothing(self):
        w = self.use(World()); w.fail.add("list")
        code, _ = self.post()
        self.assertEqual(code, 500)
        self.assertEqual(self.writes(), [])

    def test_empty_listing_is_refused(self):
        w = self.use(World(logins=set()))
        code, out = self.post()
        self.assertEqual(code, 409, out)
        self.assertIn("empty", out["error"])
        self.assertEqual(self.writes(), [])

    def test_staging_shape_seeded_students_without_logins_trip_the_abnormal_guard(self):
        # Staging, 13 Oct 2026: 15,011 students, 15,004 with no Identity row (their login id falls back to their app id,
        # which Google does not know). A sync must change nothing there.
        w = World(n_students=1500, logins={f"p{i}" for i in range(7)})
        self.use(w)
        code, out = self.post()
        self.assertEqual(code, 409, out)
        self.assertIn("abnormal-drop guard", out["error"])
        self.assertEqual(self.writes(), [])
        self.assertTrue(all(v == "active" for v in w.status.values()))

    def test_paging_error_in_the_middle_of_the_listing_changes_nothing(self):
        pages = iter([(200, {"users": [{"localId": "p0"}], "nextPageToken": "a+b/c="}), (400, {"error": "INVALID_PAGE_TOKEN"})])
        orig_call, orig_token = server.call, server.google_token
        server.call = lambda *a, **k: next(pages)
        server.google_token = lambda: "token"
        try:
            with self.assertRaises(RuntimeError):
                orig_all_login_ids()
        finally:
            server.call, server.google_token = orig_call, orig_token

    # ---- the grace period, ceiling and reruns of the same event
    def test_missing_login_is_marked_then_suspended_after_grace_then_restored_when_it_returns(self):
        w = self.use(World(logins={f"p{i}" for i in range(200) if i != 3}))
        code, out = self.post()
        self.assertEqual((code, out["newly_missing"], out["suspended"]), (200, 1, 0))
        self.assertEqual(w.status["s3"], "active", "never suspended on the first sighting")
        w.age(10); self.post()
        self.assertEqual(w.status["s3"], "active", "still inside the grace period")
        w.age(45); code, out = self.post()
        self.assertEqual((code, out["suspended"], w.status["s3"]), (200, 1, "suspended"))
        w.logins.add("p3"); code, out = self.post()
        self.assertEqual((code, out["restored"], w.status["s3"]), (200, 1, "active"))
        self.assertNotIn("s3", w.ledger)

    def test_the_same_event_twice_has_no_extra_effect(self):
        w = self.use(World(logins={f"p{i}" for i in range(200) if i != 3}))
        self.post(); w.age(45); self.post()
        first = (dict(w.status), json.dumps(w.ledger, sort_keys=True))
        code, out = self.post()
        self.assertEqual((code, out["suspended"], out["newly_missing"]), (200, 0, 0))
        self.assertEqual((dict(w.status), json.dumps(w.ledger, sort_keys=True)), first)

    def test_more_than_the_ceiling_suspends_nobody_and_asks_for_review(self):
        w = self.use(World(logins={f"p{i}" for i in range(200) if i not in (1, 2, 3, 4)}))
        self.post(); w.age(45)
        code, out = self.post()
        self.assertEqual(code, 200)
        self.assertIn("admin must review", out["review"])
        self.assertTrue(all(v == "active" for v in w.status.values()))

    def test_protected_test_accounts_are_never_marked_or_suspended(self):
        w = self.use(World(logins={f"p{i}" for i in range(200) if i != 5}, protected={"s5"}))
        self.post(); w.age(45); self.post()
        self.assertEqual(w.status["s5"], "active")
        self.assertNotIn("s5", w.ledger)

    # ---- partial database failures and retries
    def test_ledger_read_or_student_list_failure_changes_nothing(self):
        for what in ("students", "ledger_read"):
            w = self.use(World(logins={f"p{i}" for i in range(200) if i != 3})); w.fail.add(what)
            self.assertEqual(self.post()[0], 500, what)
            self.assertEqual(self.writes(), [], what)

    def test_a_failed_ledger_write_is_reported_not_answered_ok(self):
        w = self.use(World(logins={f"p{i}" for i in range(200) if i != 3})); w.fail.add("mark")
        code, out = self.post()
        self.assertEqual(code, 500, f"the newly missing login was not recorded, yet the sync said {code} {out}")
        w.fail.clear()
        code, out = self.post()   # the retry records it
        self.assertEqual((code, out["newly_missing"]), (200, 1))
        self.assertIn("s3", w.ledger)

    def test_restore_failure_stops_before_any_suspension_and_a_retry_finishes(self):
        w = self.use(World(logins={f"p{i}" for i in range(200) if i not in (3, 9)}))
        self.post(); w.age(45); self.post()                       # s3 and s9 suspended
        w.logins.discard("p11"); self.post(); w.age(45)           # s11 newly missing, now past its grace period
        w.logins.add("p3")                                        # s3's login came back: this pass must restore it
        w.fail.add("restore")
        code, _ = self.post()
        self.assertEqual(code, 500)
        self.assertEqual(w.status["s11"], "active", "nothing suspended after a failed restore")
        w.fail.clear()
        code, out = self.post()
        self.assertEqual(code, 200)
        self.assertEqual((w.status["s3"], w.status["s11"]), ("active", "suspended"))

    def test_suspend_failure_is_reported_and_retry_is_safe(self):
        w = self.use(World(logins={f"p{i}" for i in range(200) if i != 3}))
        self.post(); w.age(45); w.fail.add("suspend")
        self.assertEqual(self.post()[0], 500)
        self.assertEqual(w.status["s3"], "active")
        w.fail.clear()
        self.assertEqual(self.post()[1]["suspended"], 1)
        self.assertEqual(self.post()[1]["suspended"], 0, "retrying again suspends nobody twice")

    def test_a_broken_self_delete_retry_does_not_block_the_sync(self):
        w = self.use(World(logins={f"p{i}" for i in range(200) if i != 3})); w.fail.add("retry")
        code, out = self.post()
        self.assertEqual((code, out["newly_missing"]), (200, 1))

    # ---- roles
    def test_the_sync_only_ever_reads_students_and_writes_student_suspensions(self):
        w = self.use(World(logins={f"p{i}" for i in range(200) if i != 3}))
        self.post(); w.age(45); self.post()
        touched = {c for c in w.calls if not c.startswith("identity")}
        allowed = {"POST rpc/student_logins", "GET account_sync_missing", "GET protected_test_accounts",
                   "POST account_sync_missing", "POST rpc/sync_suspend_students", "POST rpc/sync_restore_students",
                   "GET removed_students", "PATCH removed_students"}
        self.assertTrue(touched <= allowed, touched - allowed)
        self.assertNotIn("POST rpc/remove_students", touched, "the sync never deletes anyone")


orig_all_login_ids = server.all_login_ids

if __name__ == "__main__":
    unittest.main(verbosity=2)
