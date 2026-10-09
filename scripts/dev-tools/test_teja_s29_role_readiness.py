"""Deterministic tests for teja_s29_role_readiness.py. No network, no cloud, no accounts.

  python scripts/dev-tools/test_teja_s29_role_readiness.py
"""
import contextlib
import io
import pathlib
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import teja_s29_role_readiness as s29  # noqa: E402

R = s29.ROLES
COLLEGE = s29.STAGING_FAKE_COLLEGE
OTHER = "11111111-2222-4333-8444-555555555555"
GOOGLE_UID = "Xk3mGoogleMadeUid0001"
SOURCE = pathlib.Path(s29.__file__).read_text(encoding="utf-8")


def login(uid, **extra):
    return [{"localId": uid, "disabled": False, "has_password": True, **extra}]


def good_db(name):
    """The database facts a healthy fixture account would have."""
    role = R[name]["role"]
    db = {"user_role": {"role": role}, "college": None, "company": None, "student": None, "student_college": None}
    if role == "student":
        db["student"] = {"has_name": True, "college_id": COLLEGE, "status": "active", "onboarding_status": "invited"}
        db["student_college"] = {"id": COLLEGE, "status": "active", "verification_status": "approved"}
    if role == "college_admin":
        db["college"] = {"id": COLLEGE, "status": "active", "verification_status": "approved"}
    if role == "startup":
        db["company"] = {"id": OTHER, "status": "active", "verification_status": "approved"}
    return db


def verdict(name, identities=None, mapping=None, db="good", credentials=True):
    identities = login(R[name]["id"]) if identities is None else identities
    return s29.assess(R[name], identities, mapping, good_db(name) if db == "good" else db, credentials)


class Ready(unittest.TestCase):
    def test_all_five_are_ready_when_everything_lines_up(self):
        for name in R:
            self.assertEqual(verdict(name), ("READY", "OK"), name)

    def test_google_made_id_is_ready_only_through_the_mapping_row(self):
        ids = login(GOOGLE_UID)
        self.assertEqual(verdict("ADMIN", ids, {"user_id": R["ADMIN"]["id"]}), ("READY", "OK"))


class MissingIdentity(unittest.TestCase):
    def test_no_login(self):
        for name in R:
            self.assertEqual(verdict(name, []), ("BLOCKED", "IDENTITY_MISSING"), name)

    def test_two_logins_is_never_guessed(self):
        self.assertEqual(verdict("TPO", login("a") + login("b")), ("BLOCKED", "IDENTITY_AMBIGUOUS"))

    def test_disabled_or_passwordless_login(self):
        self.assertEqual(verdict("TPO", login(R["TPO"]["id"], disabled=True)), ("BLOCKED", "IDENTITY_DISABLED"))
        self.assertEqual(verdict("TPO", login(R["TPO"]["id"], has_password=False)), ("BLOCKED", "IDENTITY_NO_PASSWORD"))


class UidMismatch(unittest.TestCase):
    def test_login_with_another_uuid_can_never_be_the_fixture(self):
        self.assertEqual(verdict("ADMIN", login(OTHER)), ("BLOCKED", "UID_MISMATCH"))

    def test_another_uuid_is_not_rescued_by_a_mapping_row(self):
        # A uuid-shaped id passes straight through the bridge; account_identities is not consulted.
        self.assertEqual(verdict("ADMIN", login(OTHER), {"user_id": R["ADMIN"]["id"]}), ("BLOCKED", "UID_MISMATCH"))

    def test_mapping_row_pointing_at_another_account(self):
        self.assertEqual(verdict("ADMIN", login(GOOGLE_UID), {"user_id": OTHER}), ("BLOCKED", "UID_MISMATCH"))

    def test_uuid_case_does_not_matter(self):
        self.assertEqual(verdict("ADMIN", login(R["ADMIN"]["id"].upper())), ("READY", "OK"))


class MissingDatabaseMapping(unittest.TestCase):
    def test_google_made_id_without_a_row(self):
        self.assertEqual(verdict("ADMIN", login(GOOGLE_UID), None), ("BLOCKED", "DB_MAPPING_MISSING"))

    def test_database_not_read_is_blocked_not_assumed(self):
        self.assertEqual(verdict("ADMIN", login(GOOGLE_UID), "UNKNOWN", None), ("BLOCKED", "DB_NOT_CHECKED"))
        self.assertEqual(verdict("TPO", db=None), ("BLOCKED", "DB_NOT_CHECKED"))

    def test_account_with_no_role_row(self):
        db = good_db("COMPANY")
        db["user_role"] = None
        self.assertEqual(verdict("COMPANY", db=db), ("BLOCKED", "ACCOUNT_NOT_PROVISIONED"))

    def test_role_row_without_its_profile_row(self):
        for name, key in (("TPO", "college"), ("COMPANY", "company"), ("STUDENT", "student")):
            db = good_db(name)
            db[key] = None
            self.assertEqual(verdict(name, db=db), ("BLOCKED", "PROFILE_MISSING"), name)


class WrongRole(unittest.TestCase):
    def test_every_role_refuses_every_other_role(self):
        for name in R:
            for other in ("admin", "college_admin", "startup", "student"):
                if other == R[name]["role"]:
                    continue
                db = good_db(name)
                db["user_role"] = {"role": other}
                self.assertEqual(verdict(name, db=db), ("BLOCKED", "WRONG_ROLE"), f"{name} as {other}")


class Suspended(unittest.TestCase):
    def test_student(self):
        for change in ({"status": "suspended"}, {"status": "removed"}, {"onboarding_status": "blocked"}):
            db = good_db("STUDENT")
            db["student"].update(change)
            self.assertEqual(verdict("STUDENT", db=db), ("BLOCKED", "SUSPENDED"), change)

    def test_college_and_company(self):
        for name, key in (("TPO", "college"), ("COMPANY", "company")):
            for change in ({"status": "suspended"}, {"verification_status": "rejected"}):
                db = good_db(name)
                db[key].update(change)
                self.assertEqual(verdict(name, db=db), ("BLOCKED", "SUSPENDED"), f"{name} {change}")

    def test_student_of_a_suspended_or_unapproved_college(self):
        for change in ({"status": "suspended"}, {"verification_status": "pending"}):
            db = good_db("ESTABLISHED")
            db["student_college"].update(change)
            self.assertEqual(verdict("ESTABLISHED", db=db), ("BLOCKED", "ORGANISATION_NOT_APPROVED"), change)

    def test_pending_college_owner_may_still_sign_in(self):
        # web_login_identity refuses only 'suspended' and 'rejected' for an organisation owner.
        db = good_db("TPO")
        db["college"]["verification_status"] = "pending"
        self.assertEqual(verdict("TPO", db=db), ("READY", "OK"))


class WrongOrganisation(unittest.TestCase):
    def test_student_in_another_college(self):
        db = good_db("STUDENT")
        db["student"]["college_id"] = OTHER
        db["student_college"]["id"] = OTHER
        self.assertEqual(verdict("STUDENT", db=db), ("BLOCKED", "WRONG_ORGANISATION"))

    def test_tpo_owning_another_college(self):
        db = good_db("TPO")
        db["college"]["id"] = OTHER
        self.assertEqual(verdict("TPO", db=db), ("BLOCKED", "WRONG_ORGANISATION"))

    def test_company_checked_when_an_expected_company_is_given(self):
        expect = {**R["COMPANY"], "org": COLLEGE}
        result = s29.assess(expect, login(expect["id"]), None, good_db("COMPANY"))
        self.assertEqual(result, ("BLOCKED", "WRONG_ORGANISATION"))

    def test_student_without_a_college(self):
        db = good_db("STUDENT")
        db["student"]["college_id"] = None
        self.assertEqual(verdict("STUDENT", db=db), ("BLOCKED", "PROFILE_MISSING"))


class Credentials(unittest.TestCase):
    def test_everything_right_but_no_test_credentials(self):
        self.assertEqual(verdict("ADMIN", credentials=False), ("BLOCKED", "CREDENTIALS_NOT_SUPPLIED"))


class TodayOnStaging(unittest.TestCase):
    """The state S25 measured: Admin has a Google-made id, the other four have no login."""

    def lookup(self, email):
        return login(GOOGLE_UID) if email == R["ADMIN"]["email"] else []

    def test_identity_only_run(self):
        results = s29.run(self.lookup, None, {})
        self.assertEqual(results["ADMIN"]["reason"], "DB_NOT_CHECKED")
        for name in ("TPO", "COMPANY", "STUDENT", "ESTABLISHED"):
            self.assertEqual(results[name]["reason"], "IDENTITY_MISSING")
        self.assertTrue(all(r["status"] == "BLOCKED" for r in results.values()))

    def test_database_run_reads_only_allowed_tables_with_get_shaped_urls(self):
        seen = []

        def fetch(url):
            seen.append(url)
            return 200, []

        results = s29.run(self.lookup, fetch, {})
        self.assertEqual(results["ADMIN"]["reason"], "DB_MAPPING_MISSING")
        self.assertEqual(results["TPO"]["fixture_database_account"], "ACCOUNT_NOT_PROVISIONED")
        for url in seen:
            self.assertTrue(url.startswith(s29.STAGING_API + "/"), url)
            table = url[len(s29.STAGING_API) + 1:].split("?")[0]
            self.assertIn(table, s29.DB_READS)
            self.assertNotIn("rpc/", url)
            self.assertIn("limit=1", url)

    def test_a_failed_database_read_stops_the_run(self):
        with self.assertRaises(SystemExit) as stop:
            s29.run(self.lookup, lambda url: (500, "boom SECRET"), {})
        self.assertNotIn("SECRET", str(stop.exception))


class Safety(unittest.TestCase):
    def test_staging_get_refuses_other_tables_and_filters(self):
        fetch = lambda url: (200, [])  # noqa: E731
        for table, row_filter in (("auth.users", "id=eq.1"), ("web_sessions", "user_id=eq.1"),
                                  ("user_roles", "user_id=eq.1&select=*"), ("user_roles", "role=eq.admin"),
                                  ("user_roles", "user_id=neq.1"), ("rpc/web_login_identity", "id=eq.1")):
            with self.assertRaises(ValueError):
                s29.staging_get(table, row_filter, fetch)

    def test_only_staging_and_the_identity_lookup_are_addressed(self):
        hosts = set(re.findall(r"https://[A-Za-z0-9.\-]+", SOURCE))
        self.assertEqual(hosts, {"https://identitytoolkit.googleapis.com",
                                 "https://prooflab-staging-api-ysn2mpe6sa-el.a.run.app"})

    def test_SOURCE_has_no_mutating_call(self):
        for word in ('"PATCH"', '"PUT"', '"DELETE"', "accounts:update", "accounts:delete", "accounts:signUp",
                     "batchCreate", "batchDelete", "signInWithPassword", "sendOobCode", "secrets versions",
                     "gcloud sql", "run deploy", "setIamPolicy"):
            self.assertNotIn(word, SOURCE, word)
        # The single POST is the Identity lookup query.
        self.assertEqual(SOURCE.count('method="POST"'), 1)

    def test_output_has_no_address_id_or_secret(self):
        environ = {"E2E_ADMIN_EMAIL": "someone@example.test", "E2E_ADMIN_PASSWORD": "hunter2-PASSWORD"}
        lookup = lambda email: login(GOOGLE_UID)  # noqa: E731
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            results = s29.run(lookup, None, environ)
            print(results)
        text = out.getvalue()
        for secret in ("hunter2", "someone@example.test", GOOGLE_UID, "@", "passwordHash"):
            self.assertNotIn(secret, text, secret)

    def test_unknown_argument_is_refused(self):
        old = sys.argv
        sys.argv = ["x", "--fix"]
        try:
            with self.assertRaises(SystemExit):
                s29.main()
        finally:
            sys.argv = old

    def test_every_reason_has_plain_words(self):
        for code in set(re.findall(r'return (?:BLOCKED, )?"([A-Z_]+)"', SOURCE)) - {"UNKNOWN"}:
            self.assertIn(code, s29.REASONS, code)


if __name__ == "__main__":
    unittest.main(verbosity=1)
