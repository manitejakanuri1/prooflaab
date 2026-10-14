"""S40/S41 (item 6): accounts with no Google link must never be cut by the identity sync.

    python accounts/test_sync_unmapped.py

S40 found that accounts without an account_identities row (15,004 seeded students on staging, 13 Oct 2026) were
treated as missing logins: every staging pass aborted, and elsewhere the exact lookup of the stand-in id said
"absent" and their access was cut. TEJA's e9b1d52 replaced S40's stand-in-id rule with an explicit `linked` flag
from identity_sync_accounts (migration 110), and links an unlinked account whose own id IS a listed Google login.
These tests hold that design to the same promises.
"""
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync_plan import plan  # noqa: E402

NOW = datetime(2026, 10, 13, 6, 0, tzinfo=timezone.utc)


def linked(i, role="student", status=None, minutes=45):
    return {"user_id": f"00000000-0000-4000-8000-{i:012d}", "role": role, "provider_uid": f"google-{i}", "linked": True,
            "protected": False, "in_app_deletion": False, "ledger_status": status,
            "first_missing_at": (NOW - timedelta(minutes=minutes)).isoformat() if status else None}


def unlinked(i, role="student", status=None, minutes=45):
    uid = f"00000000-0000-4000-9000-{i:012d}"
    a = linked(i, role, status, minutes)
    a.update(user_id=uid, provider_uid=uid, linked=False)   # identity_sync_accounts with no account_identities row
    return a


def listed(accounts, but=()):
    return {a["provider_uid"]: False for a in accounts if a["user_id"] not in but}


class Unlinked(unittest.TestCase):
    def test_staging_shape_15004_unlinked_do_not_stop_the_sync_or_get_marked(self):
        real = [linked(i, r) for i, r in enumerate(["student", "college_admin", "startup", "recruiter", "admin", "student", "student"])]
        seeded = [unlinked(i) for i in range(15004)]
        r = plan(real + seeded, listed(real), NOW)
        self.assertIsNone(r["abort"], "15,004 seeded records must not make every pass abort")
        self.assertEqual((r["mark"], r["verify"], r["link"]), ([], [], []))

    def test_a_real_linked_account_deleted_in_google_is_still_found_among_them(self):
        real = [linked(i) for i in range(7)]
        r = plan(real + [unlinked(i) for i in range(15004)], listed(real, but={real[2]["user_id"]}), NOW)
        self.assertEqual([a["user_id"] for a in r["mark"]], [real[2]["user_id"]])

    def test_an_unlinked_account_is_never_cut_even_with_an_old_ledger_row(self):
        real = [linked(i) for i in range(1000)]
        ghosts = [unlinked(i, "student", status="observed_missing") for i in range(2)]
        r = plan(real + ghosts, listed(real), NOW)
        self.assertEqual((r["verify"], r["mark"]), ([], []))
        r = plan(real + [unlinked(i, "admin") for i in range(3)], listed(real), NOW)
        self.assertEqual(r["mark"], [], "no role is marked without a link")

    def test_an_older_login_whose_google_id_is_the_app_uuid_gets_linked_not_cut(self):
        real = [linked(i) for i in range(50)]
        legacy = unlinked(1)
        r = plan(real + [legacy], {**listed(real), legacy["provider_uid"]: False}, NOW)
        self.assertEqual([a["user_id"] for a in r["link"]], [legacy["user_id"]])
        self.assertNotIn(legacy["user_id"], r["missing"])

    def test_on_hold_accounts_get_no_automatic_step_at_all(self):
        real = [linked(i) for i in range(50)]
        held = dict(linked(99, "admin", status="observed_missing"), on_hold=True)
        legacy = dict(unlinked(5), on_hold=True)
        r = plan(real + [held, legacy], {**listed(real), legacy["provider_uid"]: False}, NOW)
        self.assertEqual((r["verify"], r["mark"], r["link"], r["recover"]), ([], [], [], []))

    def test_an_empty_or_abnormal_listing_links_nobody(self):
        real = [linked(i) for i in range(100)]
        legacy = unlinked(1)
        self.assertEqual(plan(real + [legacy], {}, NOW)["link"], [])
        r = plan(real + [legacy], {legacy["provider_uid"]: False}, NOW)   # 100 linked logins all gone
        self.assertIsNotNone(r["abort"])
        self.assertEqual(r["link"], [], "an untrustworthy listing links nobody either")


if __name__ == "__main__":
    unittest.main(verbosity=2)
