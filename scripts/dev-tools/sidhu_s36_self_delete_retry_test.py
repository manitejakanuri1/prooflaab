"""S36 QA: retry of unfinished login deletions (accounts/self_delete.py). OFFLINE, no network.

    python scripts/dev-tools/sidhu_s36_self_delete_retry_test.py

The two REPRO tests of S36-06 and S36-06b were turned into normal tests when TEJA fixed them (S36).
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "accounts"))
import self_delete  # noqa: E402


class FakeDb:
    """removed_students as PostgREST serves it, honouring the order and limit the service asks for."""

    def __init__(self, rows):
        self.rows = rows
        for r in rows:
            r.setdefault("login_delete_attempts", 0)

    def __call__(self, path, body=None, method="POST"):
        if method == "GET" and path.startswith("removed_students?select=student_id,snapshot"):
            assert "order=login_delete_attempts.asc,removed_at.asc" in path, path
            limit = int(path.split("limit=")[1].split("&")[0])
            pending = [r for r in self.rows if r["login_deleted_at"] is None]
            pending.sort(key=lambda r: r["login_delete_attempts"])  # stable: insertion order = removed_at
            return 200, pending[:limit]
        if method == "PATCH" and path.startswith("removed_students?student_id=eq."):
            sid = path.split("student_id=eq.")[1].split("&")[0]
            for r in self.rows:
                if r["student_id"] == sid and r["login_deleted_at"] is None:
                    r.update(body)
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

    def test_S36_06_fixed_stuck_rows_cannot_starve_a_newer_row_and_nothing_sleeps(self):
        # Was REPRO S36-06 (TEJA, S36): 50 stuck rows starved every newer row and slept 150 s a run.
        stuck = [{"student_id": f"old{i}", "snapshot": {"provider_uid": f"bad{i}"}, "login_deleted_at": None} for i in range(50)]
        fresh = {"student_id": "new", "snapshot": {"provider_uid": "good"}, "login_deleted_at": None}
        db = FakeDb(stuck + [fresh])
        slept = []
        runs = 0
        while fresh["login_deleted_at"] is None and runs < 10:
            self_delete.retry_pending(identity_refusing({f"bad{i}" for i in range(50)}), db, slept.append)
            runs += 1
        self.assertIsNotNone(fresh["login_deleted_at"], "the deletable login is reached")
        self.assertLessEqual(runs, 6, "within a few runs: least-tried rows go first")
        self.assertEqual(slept, [], "no waiting inside the console-sync request")

    def test_S36_06b_fixed_a_row_without_a_login_id_is_reported_and_does_not_block_others(self):
        # Was REPRO S36-06b: such a row stayed pending silently. A machine still cannot finish it,
        # so it is counted for a person and moved to the back of the queue.
        rows = [{"student_id": "pre107", "snapshot": {"self_requested": True}, "login_deleted_at": None},
                {"student_id": "ok", "snapshot": {"provider_uid": "g"}, "login_deleted_at": None}]
        db = FakeDb(rows)
        out = self_delete.retry_pending(identity_refusing(set()), db)
        self.assertEqual((out["needs_review"], out["finished"]), (1, 1))
        self.assertEqual(rows[0]["login_delete_attempts"], 1)
        self.assertIsNone(rows[0]["login_deleted_at"], "never marked as deleted")


if __name__ == "__main__":
    unittest.main(verbosity=2)
