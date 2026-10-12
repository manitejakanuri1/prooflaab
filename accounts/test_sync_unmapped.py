"""S40 (item 6): accounts with no Google mapping must never be cut by the identity sync.

    python accounts/test_sync_unmapped.py

identity_sync_accounts() (migration 110) gives an account with no account_identities row the login id
`user_id::text`. That is right for an older login whose Google id IS the app uuid (resolve_account_uuid uses a
uuid-shaped Google id directly), and wrong for a synthetic or seeded account that never had a Google login:
staging has 15,004 such students (read-only count, 13 Oct 2026). Google does not know them, so the sync saw them as
missing: on staging every pass aborted, and in a database with a handful of them the exact lookup of the stand-in
id answered "absent" and their access was cut after the grace period, three per pass.
"""
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_plan import Limits, plan  # noqa: E402

NOW = datetime(2026, 10, 13, 6, 0, tzinfo=timezone.utc)


def mapped(i, role="student", status=None, minutes=45):
    return {"user_id": f"00000000-0000-4000-8000-{i:012d}", "role": role, "provider_uid": f"google-{i}",
            "protected": False, "in_app_deletion": False, "ledger_status": status,
            "first_missing_at": (NOW - timedelta(minutes=minutes)).isoformat() if status else None}


def unmapped(i, role="student", status=None, minutes=45):
    uid = f"00000000-0000-4000-9000-{i:012d}"
    a = mapped(i, role, status, minutes)
    a.update(user_id=uid, provider_uid=uid)   # what identity_sync_accounts returns with no account_identities row
    return a


def everyone_logged_in(accounts, but=()):
    return {a["provider_uid"]: False for a in accounts if a["user_id"] not in but and not a["provider_uid"].startswith("00000000-0000-4000-9000")}


class Unmapped(unittest.TestCase):
    def test_staging_shape_15004_unmapped_do_not_stop_the_sync_or_get_marked(self):
        real = [mapped(i, r) for i, r in enumerate(["student", "college_admin", "startup", "recruiter", "admin", "student", "student"])]
        seeded = [unmapped(i) for i in range(15004)]
        logins = everyone_logged_in(real)
        r = plan(real + seeded, logins, NOW)
        self.assertIsNone(r["abort"], "15,004 seeded records must not make every pass abort")
        self.assertEqual((r["mark"], r["verify"]), ([], []))
        self.assertEqual(r.get("unmapped_absent"), 15004, "reported, so a person can see them")

    def test_a_real_mapped_account_deleted_in_google_is_still_found_among_them(self):
        real = [mapped(i) for i in range(7)]
        seeded = [unmapped(i) for i in range(15004)]
        logins = everyone_logged_in(real, but={real[2]["user_id"]})
        r = plan(real + seeded, logins, NOW)
        self.assertEqual([a["user_id"] for a in r["mark"]], [real[2]["user_id"]])

    def test_an_unmapped_account_is_never_cut_even_after_the_grace_period(self):
        real = [mapped(i) for i in range(1000)]
        ghosts = [unmapped(i, "student", status="observed_missing") for i in range(2)]   # a ledger row from before
        r = plan(real + ghosts, everyone_logged_in(real), NOW)
        self.assertEqual(r["verify"], [], "never handed to the exact lookup, so never cut")
        new = [unmapped(i, "admin") for i in range(3)]
        r = plan(real + new, everyone_logged_in(real), NOW)
        self.assertEqual(r["mark"], [], "never marked either")

    def test_an_older_login_whose_google_id_is_the_app_uuid_still_counts_as_present(self):
        real = [mapped(i) for i in range(50)]
        legacy = unmapped(1)
        logins = {**everyone_logged_in(real), legacy["provider_uid"]: False}
        r = plan(real + [legacy], logins, NOW)
        self.assertNotIn(legacy["user_id"], r["missing"])
        self.assertEqual(r.get("unmapped_absent"), 0)

    def test_an_unmapped_account_whose_uuid_login_is_disabled_is_still_handled(self):
        # Present in Google (so the mapping is proven) but disabled: that is a real login, treat it like any other.
        real = [mapped(i) for i in range(50)]
        legacy = unmapped(1)
        logins = {**everyone_logged_in(real), legacy["provider_uid"]: True}
        r = plan(real + [legacy], logins, NOW)
        self.assertEqual([a["user_id"] for a in r["mark"]], [legacy["user_id"]])

    def test_mapped_accounts_behave_exactly_as_before(self):
        real = [mapped(i) for i in range(100)]
        gone = mapped(500, "college_admin", status="observed_missing", minutes=45)
        r = plan(real + [gone], everyone_logged_in(real), NOW)
        self.assertEqual([a["user_id"] for a in r["verify"]], [gone["user_id"]])
        r = plan(real, {}, NOW)
        self.assertEqual(r["abort"], "the login listing is empty")


if __name__ == "__main__":
    unittest.main(verbosity=2)
