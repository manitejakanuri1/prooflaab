"""S40 fault injection for the Google Identity -> app account sync (POST /sync). OFFLINE: the real HTTP handler of
server.py runs on a local port; Google Identity and the database are fakes that can fail on demand.

    python accounts/test_sync_faults.py      (exits non-zero on failure)

Sidhu S40 (8c57c06) wrote this against the student-only sync. TEJA ported it to the all-role ledger of migration 110
(identity_sync_accounts / identity_sync_apply / identity_link_present, exact lookup before any cut) and kept every
case: authentication, the dry run (routing fix 8c57c06), listing and paging failures, empty and abnormal listings,
the staging shape (thousands of seeded students with no login), reruns of the same event, partial database failures,
retries, protected accounts, and that the sync never deletes anyone or writes to Google.
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
os.environ.setdefault("GCP_PROJECT", "proj-iso")
import server  # noqa: E402

server.WEBHOOK = "test-webhook-secret"
ROLES = ["student", "college_admin", "startup", "recruiter", "admin"]


class World:
    """Google logins, the accounts, the migration-110 ledger and student status, with switchable failures."""

    clock = datetime(2026, 10, 13, 6, 0, tzinfo=timezone.utc)

    def __init__(self, n=200, logins=None, protected=(), unlinked=0):
        self.accounts = [{"user_id": f"s{i}", "role": ROLES[i % 5], "provider_uid": f"p{i}", "linked": True}
                         for i in range(n)]
        self.accounts += [{"user_id": f"x{i}", "role": "student", "provider_uid": f"x{i}", "linked": False}
                          for i in range(unlinked)]
        self.logins = {f"p{i}": False for i in range(n)} if logins is None else {u: False for u in logins}
        self.ledger = {}            # user_id -> {status, first_missing_at, suspended}
        self.status = {a["user_id"]: "active" for a in self.accounts if a["role"] == "student"}
        self.cut = set()
        self.protected = set(protected)
        self.fail = set()           # list, accounts, apply, lookup, retry
        self.calls = []

    def now(self):
        return World.clock

    def age(self, minutes):
        for v in self.ledger.values():
            v["first_missing_at"] = (self.now() - timedelta(minutes=minutes)).isoformat()

    # ---- Google Identity
    def all_logins(self):
        self.calls.append("identity.list")
        if "list" in self.fail:
            raise RuntimeError("could not list logins: 503 backend error")
        return dict(self.logins)

    def identity(self, path, body):
        self.calls.append(f"identity.{path}")
        if path != "accounts:lookup":
            raise AssertionError(f"the sync must never call Google {path}")
        if "lookup" in self.fail:
            return 503, {}
        uid = body["localId"][0]
        return 200, ({"users": [{"localId": uid, "disabled": self.logins[uid]}]} if uid in self.logins else {})

    # ---- PostgREST
    def db(self, path, body=None, method="POST", prefer=None):
        self.calls.append(f"{method} {path.split('?')[0]}")
        if path == "rpc/identity_due_deletions" or path.startswith("removed_students"):
            if "retry" in self.fail:
                raise RuntimeError("retry exploded")
            return 200, []
        if path == "rpc/identity_sync_accounts":
            if "accounts" in self.fail:
                return 500, {"message": "down"}
            out = []
            for a in self.accounts:
                led = self.ledger.get(a["user_id"])
                out.append({**a, "protected": a["user_id"] in self.protected, "in_app_deletion": False,
                            "ledger_status": led and led["status"], "first_missing_at": led and led["first_missing_at"]})
            return 200, out
        if path == "rpc/identity_sync_apply":
            if "apply" in self.fail:
                return 503, {"message": "could not write"}       # atomic: nothing of this pass is applied
            n = {"marked": 0, "verified": 0, "suspended": 0, "recovered": 0, "restored": 0, "skipped": 0}
            for m in body["_mark"]:
                if m["user_id"] in self.protected or m["user_id"] in self.ledger:
                    n["skipped"] += 1; continue
                self.ledger[m["user_id"]] = {"status": "observed_missing", "first_missing_at": self.now().isoformat(),
                                             "suspended": False}
                n["marked"] += 1
            for v in body["_verified"]:
                led = self.ledger.get(v["user_id"])
                if not led or led["status"] != "observed_missing" or v["user_id"] in self.protected:
                    n["skipped"] += 1; continue
                led["status"] = "verified_missing"; self.cut.add(v["user_id"]); n["verified"] += 1
                if self.status.get(v["user_id"]) == "active":
                    self.status[v["user_id"]] = "suspended"; led["suspended"] = True; n["suspended"] += 1
            for r in body["_recover"]:
                led = self.ledger.pop(r["user_id"], None)
                if not led:
                    n["skipped"] += 1; continue
                self.cut.discard(r["user_id"]); n["recovered"] += 1
                if led["suspended"] and self.status.get(r["user_id"]) == "suspended":
                    self.status[r["user_id"]] = "active"; n["restored"] += 1
            return 200, n
        if path == "rpc/identity_link_present":
            return 200, len(body["_rows"])
        if path == "rpc/identity_lifecycle_health":
            return 200, {"pending_over_1h": 0, "failed": 0}
        raise AssertionError(f"unexpected database call {method} {path}")


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
        server.all_logins, server.db, server.identity = world.all_logins, world.db, world.identity
        real_plan = server.sync_plan.plan
        server.sync_plan.plan = lambda a, l, now, *x, **k: real_plan(a, l, world.now(), *x, **k)
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
        return [c for c in self.w.calls if c in ("POST rpc/identity_sync_apply", "POST rpc/identity_link_present")]

    def missing(self, *ids):
        return {f"p{i}" for i in range(200) if i not in ids}

    # ---- authentication
    def test_no_or_wrong_secret_is_refused_and_touches_nothing(self):
        w = self.use(World())
        for secret in (None, "", "wrong"):
            self.assertEqual(self.post(secret=secret)[0], 401)
        self.assertEqual(w.calls, [])

    # ---- the dry run (S40 routing fix: /sync?dry_run=1 used to answer 404)
    def test_dry_run_reports_and_changes_nothing(self):
        w = self.use(World(logins=self.missing(7)))
        w.ledger["s7"] = {"status": "observed_missing", "suspended": False,
                          "first_missing_at": (w.now() - timedelta(hours=2)).isoformat()}
        code, out = self.post("/sync?dry_run=1")
        self.assertEqual(code, 200, out)
        self.assertEqual((out.get("dry_run"), out.get("would_cut")), (True, ["s7"]))
        self.assertEqual(self.writes(), [])
        self.assertNotIn("POST rpc/identity_due_deletions", w.calls, "a dry run does not retry deletions either")

    # ---- Google side failures
    def test_listing_failure_changes_nothing(self):
        w = self.use(World()); w.fail.add("list")
        self.assertEqual(self.post()[0], 502)
        self.assertEqual(self.writes(), [])

    def test_empty_listing_is_refused(self):
        self.use(World(logins=set()))
        code, out = self.post()
        self.assertEqual(code, 409, out)
        self.assertIn("empty", out["error"])
        self.assertEqual(self.writes(), [])

    def test_staging_shape_seeded_students_without_logins_are_ignored_not_deleted(self):
        # Staging, 13 Oct 2026: 15,004 seeded students never had a Google login (no link). They are not counted as
        # missing, nothing is written for them, and a real linked login is still reconciled next to them.
        w = self.use(World(n=7, unlinked=15000))
        code, out = self.post()
        self.assertEqual((code, out["missing_now"], out["unlinked_ignored"]), (200, 0, 15000), out)
        self.assertEqual(self.writes(), [])
        self.assertTrue(all(v == "active" for v in w.status.values()))
        w.logins.pop("p3")
        code, out = self.post()
        self.assertEqual((code, out["newly_missing"]), (200, 1), out)

    def test_if_seeded_students_were_linked_the_abnormal_guard_stops_everything(self):
        w = World(n=7)
        w.accounts += [{"user_id": f"x{i}", "role": "student", "provider_uid": f"x{i}", "linked": True} for i in range(1500)]
        self.use(w)
        code, out = self.post()
        self.assertEqual(code, 409, out)
        self.assertIn("abnormal-drop guard", out["error"])
        self.assertEqual(self.writes(), [])

    def test_paging_error_in_the_middle_of_the_listing_changes_nothing(self):
        pages = iter([(200, {"users": [{"localId": "p0"}], "nextPageToken": "a+b/c="}), (400, {"error": "INVALID_PAGE_TOKEN"})])
        with self.assertRaises(RuntimeError):
            orig_all_logins(lambda url: next(pages))

    def test_lookup_failure_cuts_nobody(self):
        w = self.use(World(logins=self.missing(3)))
        self.post(); w.age(45); w.fail.add("lookup")
        code, out = self.post()
        self.assertEqual(code, 200)
        self.assertNotIn("s3", w.cut)

    # ---- the grace period, ceiling and reruns of the same event, every role
    def test_missing_login_is_marked_then_cut_after_grace_then_restored_when_it_returns(self):
        for i in range(5):                      # s0 student, s1 college, s2 company, s3 recruiter, s4 admin
            w = self.use(World(logins=self.missing(i)))
            code, out = self.post()
            self.assertEqual((code, out["newly_missing"], out["verified"]), (200, 1, 0), ROLES[i])
            self.assertNotIn(f"s{i}", w.cut, "never cut on the first sighting")
            w.age(10); self.post()
            self.assertNotIn(f"s{i}", w.cut, "still inside the grace period")
            w.age(45); code, out = self.post()
            self.assertEqual((code, out["verified"]), (200, 1), ROLES[i])
            self.assertIn(f"s{i}", w.cut)
            if ROLES[i] == "student":
                self.assertEqual(w.status[f"s{i}"], "suspended")
            w.logins[f"p{i}"] = False; code, out = self.post()
            self.assertEqual((code, out["recovered"]), (200, 1), ROLES[i])
            self.assertNotIn(f"s{i}", w.cut)
            self.assertNotIn(f"s{i}", w.ledger)
            if ROLES[i] == "student":
                self.assertEqual(w.status[f"s{i}"], "active")

    def test_the_same_event_twice_has_no_extra_effect(self):
        w = self.use(World(logins=self.missing(3)))
        self.post(); w.age(45); self.post()
        first = (set(w.cut), json.dumps(w.ledger, sort_keys=True))
        code, out = self.post()
        self.assertEqual((code, out["verified"], out["newly_missing"]), (200, 0, 0))
        self.assertEqual((set(w.cut), json.dumps(w.ledger, sort_keys=True)), first)

    def test_more_than_the_ceiling_cuts_nobody_and_asks_for_review(self):
        w = self.use(World(logins=self.missing(1, 2, 3, 4)))
        self.post(); w.age(45)
        code, out = self.post()
        self.assertEqual(code, 200)
        self.assertIn("admin must review", out["review"])
        self.assertEqual(w.cut, set())

    def test_protected_test_accounts_are_never_marked_or_cut(self):
        w = self.use(World(logins=self.missing(5), protected={"s5"}))
        self.post(); w.age(45); self.post()
        self.assertNotIn("s5", w.cut)
        self.assertNotIn("s5", w.ledger)

    # ---- partial database failures and retries
    def test_account_list_failure_changes_nothing(self):
        w = self.use(World(logins=self.missing(3))); w.fail.add("accounts")
        self.assertEqual(self.post()[0], 500)
        self.assertEqual(self.writes(), [])

    def test_a_failed_ledger_write_is_reported_not_answered_ok(self):
        w = self.use(World(logins=self.missing(3))); w.fail.add("apply")
        code, out = self.post()
        self.assertEqual(code, 500, f"the newly missing login was not recorded, yet the sync said {code} {out}")
        w.fail.clear()
        code, out = self.post()   # the retry records it
        self.assertEqual((code, out["newly_missing"], out["marked"]), (200, 1, 1))
        self.assertIn("s3", w.ledger)

    def test_a_failed_pass_applies_nothing_and_a_retry_finishes_restore_and_cut(self):
        w = self.use(World(logins=self.missing(3, 9)))
        self.post(); w.age(45); self.post()                        # s3 and s9 cut
        w.logins.pop("p11"); self.post(); w.age(45)               # s11 newly missing, now past its grace period
        w.logins["p3"] = False                                    # s3's login came back: this pass must restore it
        w.fail.add("apply")
        self.assertEqual(self.post()[0], 500)
        self.assertEqual(("s3" in w.cut, "s11" in w.cut), (True, False), "an atomic pass: nothing half-applied")
        w.fail.clear()
        code, out = self.post()
        self.assertEqual(code, 200)
        self.assertEqual(("s3" in w.cut, "s11" in w.cut), (False, True))
        self.assertEqual(self.post()[1]["verified"], 0, "retrying again cuts nobody twice")

    def test_a_broken_deletion_retry_does_not_block_the_sync(self):
        w = self.use(World(logins=self.missing(3))); w.fail.add("retry")
        code, out = self.post()
        self.assertEqual((code, out["newly_missing"]), (200, 1))

    def test_look_alike_paths_are_still_404_and_touch_nothing(self):
        # S41: the router ignores the query string of /sync since S40; it must not ignore anything else.
        w = self.use(World(logins=self.missing(3)))
        for p in ("/sync/", "/syncx", "/sync/../remove", "/SYNC", "/sync%3Fdry_run=1"):
            self.assertEqual(self.post(p)[0], 404, p)
        self.assertEqual(w.calls, [])

    # ---- what the sync may touch
    def test_the_sync_never_deletes_anyone_and_never_writes_to_google(self):
        w = self.use(World(logins=self.missing(3)))
        self.post(); w.age(45); self.post()
        touched = {c for c in w.calls if not c.startswith("identity.")}
        allowed = {"POST rpc/identity_due_deletions", "GET removed_students", "PATCH removed_students",
                   "POST rpc/identity_sync_accounts", "POST rpc/identity_sync_apply", "POST rpc/identity_link_present",
                   "POST rpc/identity_lifecycle_health"}
        self.assertTrue(touched <= allowed, touched - allowed)
        self.assertNotIn("POST rpc/remove_students", touched, "the sync never deletes anyone")
        google = {c for c in w.calls if c.startswith("identity.")}
        self.assertTrue(google <= {"identity.list", "identity.accounts:lookup"}, google)


orig_all_logins = server.all_logins

if __name__ == "__main__":
    unittest.main(verbosity=2)
