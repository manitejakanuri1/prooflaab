"""S36 QA: retry of unfinished login deletions (accounts/self_delete.py). OFFLINE, no network.

    python scripts/dev-tools/sidhu_s36_self_delete_retry_test.py

Tests named REPRO pass WHILE THE FINDING EXISTS; when it is fixed they fail and should be turned into normal tests.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "accounts"))
import self_delete  # noqa: E402


class FakeDb:
    """removed_students as PostgREST serves it: no ORDER BY, so rows come back in storage (insertion) order."""

    def __init__(self, rows):
        self.rows = rows

    def __call__(self, path, body=None, method="POST"):
        if method == "GET" and path.startswith("removed_students?select=student_id,snapshot"):
            pending = [r for r in self.rows if r["login_deleted_at"] is None]
            return 200, pending[:50]
        if method == "PATCH" and path.startswith("removed_students?student_id=eq."):
            sid = path.split("student_id=eq.")[1].split("&")[0]
            for r in self.rows:
                if r["student_id"] == sid and r["login_deleted_at"] is None:
                    r["login_deleted_at"] = body["login_deleted_at"]
            return 204, None
        raise AssertionError(f"unexpected call {method} {path}")


def identity_refusing(bad):
    def call(op, body):
        if body["localId"] in bad:
            return 500, {"error": {"message": "INTERNAL"}}
        return 200, {}
    return call


class RetryPending(unittest.TestCase):
    def test_a_failed_login_is_finished_on_a_later_run(self):
        db = FakeDb([{"student_id": "s1", "snapshot": {"provider_uid": "g1"}, "login_deleted_at": None}])
        self.assertEqual(self_delete.retry_pending(identity_refusing({"g1"}), db, lambda s: None)["finished"], 0)
        self.assertEqual(self_delete.retry_pending(identity_refusing(set()), db, lambda s: None)["finished"], 1)
        self.assertIsNotNone(db.rows[0]["login_deleted_at"])

    def test_REPRO_S36_06_fifty_stuck_rows_starve_every_newer_row_and_cost_150_seconds_a_run(self):
        stuck = [{"student_id": f"old{i}", "snapshot": {"provider_uid": f"bad{i}"}, "login_deleted_at": None} for i in range(50)]
        fresh = {"student_id": "new", "snapshot": {"provider_uid": "good"}, "login_deleted_at": None}
        db = FakeDb(stuck + [fresh])
        slept = []
        for _ in range(3):  # three sync runs
            out = self_delete.retry_pending(identity_refusing({f"bad{i}" for i in range(50)}), db, slept.append)
            self.assertEqual(out["finished"], 0)
        self.assertIsNone(fresh["login_deleted_at"], "a deletable login is never reached")
        self.assertEqual(sum(slept), 3 * 50 * (1 + 2), "50 rows x (1 s + 2 s) back-off, inside the console-sync request")

    def test_REPRO_S36_06b_a_row_without_a_login_id_stays_pending_forever(self):
        db = FakeDb([{"student_id": "pre107", "snapshot": {"self_requested": True}, "login_deleted_at": None}])
        for _ in range(3):
            self.assertEqual(self_delete.retry_pending(identity_refusing(set()), db, lambda s: None)["pending"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
