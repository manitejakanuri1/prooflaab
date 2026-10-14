"""The Identity fixture preflight is read-only, asks only about the five fixtures and leaks nothing. All faked."""
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import identity_fixture_preflight as pre  # noqa: E402

IDS = {
    "admin": "ffed80fc-08ee-4cce-ac54-9432ef2d81f9",
    "tpo": "99999999-0000-0000-0000-000000000001",
    "company": "b19ab84b-2ebe-4dc8-8a51-470b2193168e",
    "student": "b3786001-a791-449a-bcd3-115f222a8bf1",
    "established": "99999999-0001-0000-0000-000000000001",
}
EMAIL = {role: spec[1] for role, spec in pre.FIXTURES.items()}
TOKEN = "TEST-ACCESS-TOKEN-NOT-REAL"
HASH = "TEST-PASSWORD-HASH-NOT-REAL"
GOOGLE_UID = "GoogleMadeUid0001"
OTHER_UUID = "11111111-2222-3333-4444-555555555555"
CONFIG = {"signIn": {"email": {"enabled": True, "passwordRequired": True}}, "multiTenant": {}}
TENANTS_OFF = (400, {"error": {"code": 400, "message": "INVALID_PROJECT_ID", "status": "INVALID_ARGUMENT"}})


def account(uid, email, **extra):
    return {"localId": uid, "email": email, "passwordHash": HASH, "providerUserInfo": [{"providerId": "password"}],
            "displayName": "PRIVATE-NAME", "lastLoginAt": "1790000000000", **extra}


def env_for(*roles):
    out = {}
    for role in roles:
        var = pre.FIXTURES[role][2]
        out[f"E2E_{var}_EMAIL"], out[f"E2E_{var}_PASSWORD"] = EMAIL[role], "TEST-PASSWORD-NOT-REAL"
    return out


class Identity(unittest.TestCase):
    def go(self, accounts=(), config=CONFIG, tenants=TENANTS_OFF, environ=None, fail=None):
        """accounts: the whole fake pool. Returns (lines by name, verdicts, calls, printed text)."""
        calls = []

        def call(method, url, body, token):
            self.assertEqual(token, TOKEN)
            self.assertIn((method, url), pre.ALLOWED)
            calls.append((method, url, body))
            if fail and fail(method, url, body):
                return fail(method, url, body)
            if url == pre.CONFIG_URL:
                return 200, config
            if url == pre.TENANTS_URL:
                return tenants
            (field, values), = body.items()
            key = "localId" if field == "localId" else "email"
            return 200, {"users": [a for a in accounts if str(a.get(key, "")).lower() == values[0].lower()]}

        lines, verdicts = pre.run(call=call, token_source=lambda: TOKEN, fixture_ids=dict(IDS), environ=environ or {})
        text = "\n".join(f"{ok} {name} {detail}" for ok, name, detail in lines)
        return {name: ok for ok, name, _ in lines}, verdicts, calls, text

    def detail(self, text, role):
        return next(line for line in text.splitlines() if f" {role}: " in line)

    # ---- outcomes ---------------------------------------------------------------------------------

    def test_empty_pool_every_fixture_is_absent_and_not_ready(self):
        _, verdicts, _, text = self.go()
        self.assertEqual(set(verdicts.values()), {"NOT_READY"})
        self.assertEqual(text.count(pre.ABSENT + ":"), 5)

    def test_exact_logins_with_credentials_supplied_are_ready(self):
        pool = [account(IDS[r], EMAIL[r]) for r in IDS]
        _, verdicts, _, _ = self.go(pool, environ=env_for(*IDS))
        self.assertEqual(set(verdicts.values()), {"READY"})

    def test_exact_login_without_supplied_credentials_is_not_ready(self):
        _, verdicts, _, text = self.go([account(IDS["student"], EMAIL["student"])])
        self.assertEqual(verdicts["student"], "NOT_READY")
        self.assertIn("set=False", self.detail(text, "student"))

    def test_supplied_address_that_is_not_the_fixture_address_is_not_ready(self):
        env = env_for("student")
        env["E2E_STUDENT_EMAIL"] = "someone.else@example.test"
        _, verdicts, _, text = self.go([account(IDS["student"], EMAIL["student"])], environ=env)
        self.assertEqual(verdicts["student"], "NOT_READY")
        self.assertNotIn("someone.else", text)

    def test_address_with_a_google_made_uid_needs_a_database_check_never_ready(self):
        # The real admin case: the address has a login, but under an id Google generated.
        _, verdicts, _, text = self.go([account(GOOGLE_UID, EMAIL["admin"])], environ=env_for("admin"))
        self.assertEqual(verdicts["admin"], "NEEDS_DB_CHECK")
        self.assertIn(pre.NEEDS_MAPPING, self.detail(text, "admin"))

    def test_address_under_a_different_uuid_can_never_be_the_fixture(self):
        _, verdicts, _, text = self.go([account(OTHER_UUID, EMAIL["tpo"])], environ=env_for("tpo"))
        self.assertEqual(verdicts["tpo"], "NOT_READY")
        self.assertIn(pre.WRONG_UUID, self.detail(text, "tpo"))

    def test_fixture_id_under_another_address_is_not_ready(self):
        _, verdicts, _, text = self.go([account(IDS["company"], "other@example.test")], environ=env_for("company"))
        self.assertEqual(verdicts["company"], "NOT_READY")
        self.assertIn(pre.UID_OTHER_EMAIL, self.detail(text, "company"))

    def test_address_and_id_as_two_different_logins_is_not_ready(self):
        pool = [account(GOOGLE_UID, EMAIL["student"]), account(IDS["student"], "other@example.test")]
        _, verdicts, _, text = self.go(pool, environ=env_for("student"))
        self.assertEqual(verdicts["student"], "NOT_READY")
        self.assertIn(pre.SPLIT, self.detail(text, "student"))

    def test_disabled_or_passwordless_logins_are_not_ready(self):
        for extra in ({"disabled": True}, {"passwordHash": ""}, {"providerUserInfo": [{"providerId": "google.com"}]}):
            _, verdicts, _, _ = self.go([account(IDS["student"], EMAIL["student"], **extra)], environ=env_for("student"))
            self.assertEqual(verdicts["student"], "NOT_READY", extra)
            _, verdicts, _, _ = self.go([account(GOOGLE_UID, EMAIL["admin"], **extra)], environ=env_for("admin"))
            self.assertEqual(verdicts["admin"], "NOT_READY", extra)

    def test_inconsistent_answers_are_ambiguous_never_guessed(self):
        self.assertEqual(pre.classify(IDS["admin"], EMAIL["admin"], [account("a", EMAIL["admin"]), account("b", EMAIL["admin"])], []), pre.AMBIGUOUS)
        self.assertEqual(pre.classify(IDS["admin"], EMAIL["admin"], [account(IDS["admin"], EMAIL["admin"])], []), pre.AMBIGUOUS)
        self.assertEqual(pre.classify(IDS["admin"], EMAIL["admin"], [account(IDS["admin"].upper(), EMAIL["admin"].upper())],
                                      [account(IDS["admin"], EMAIL["admin"])]), pre.EXACT)

    # ---- configuration and tenants -----------------------------------------------------------------

    def test_password_sign_in_off_fails(self):
        for cfg in ({"signIn": {"email": {"enabled": False, "passwordRequired": True}}}, {"signIn": {"email": {"enabled": True, "passwordRequired": False}}}, {}):
            lines, _, _, _ = self.go(config=cfg)
            self.assertFalse(lines["config: email + password sign-in is enabled"], cfg)

    def test_tenant_list_refusal_with_tenancy_off_is_information_not_a_failure(self):
        lines, _, _, text = self.go()
        self.assertIsNone(lines["tenants: list refused because multi-tenancy is off"])
        self.assertIn("INVALID_PROJECT_ID", text)
        self.assertIn("NOT enabled", text)

    def test_existing_tenants_fail_because_their_accounts_are_not_covered(self):
        lines, _, _, text = self.go(config={**CONFIG, "multiTenant": {"allowTenants": True}}, tenants=(200, {"tenants": [{"name": "projects/x/tenants/secret-tenant-id"}]}))
        self.assertFalse(lines["tenants: none exist besides the default tenant"])
        self.assertNotIn("secret-tenant-id", text)
        lines, _, _, _ = self.go(config={**CONFIG, "multiTenant": {"allowTenants": True}}, tenants=(200, {}))
        self.assertTrue(lines["tenants: none exist besides the default tenant"])

    def test_unexplained_tenant_error_fails(self):
        for tenants in ((403, {"error": {"status": "PERMISSION_DENIED"}}), (500, None), (400, {"error": {"message": "something else entirely, with detail"}})):
            lines, _, _, text = self.go(tenants=tenants)
            self.assertFalse(lines["tenants: other tenants can be ruled out"], tenants)
            self.assertNotIn("something else entirely", text)

    # ---- failing closed ------------------------------------------------------------------------------

    def test_config_unreadable_stops_before_any_lookup(self):
        lines, verdicts, calls, text = self.go(fail=lambda m, u, b: (403, {"error": {"status": "PERMISSION_DENIED", "message": "caller lacks permission on resource X"}}) if u == pre.CONFIG_URL else None)
        self.assertFalse(lines["config: Identity Platform configuration can be read"])
        self.assertEqual(verdicts, {})
        self.assertEqual([u for _, u, _ in calls], [pre.CONFIG_URL])
        self.assertIn("PERMISSION_DENIED", text)
        self.assertNotIn("caller lacks permission", text)

    def test_failed_lookup_is_not_ready(self):
        _, verdicts, _, _ = self.go([account(IDS[r], EMAIL[r]) for r in IDS], environ=env_for(*IDS),
                                    fail=lambda m, u, b: (500, None) if b and b.get("email") == [EMAIL["tpo"]] else None)
        self.assertEqual(verdicts["tpo"], "NOT_READY")
        self.assertEqual(verdicts["admin"], "READY")

    def test_no_gcloud_sign_in_fails_before_any_call(self):
        called = []
        lines, verdicts = pre.run(call=lambda *a: called.append(a), token_source=mock.Mock(side_effect=RuntimeError("no sign-in")), fixture_ids=dict(IDS), environ={})
        self.assertEqual([ok for ok, _, _ in lines][-1], False)
        self.assertEqual((called, verdicts), ([], {}))

    def test_bad_fixture_file_fails_closed(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            for content in ({"admin": "not-a-uuid"}, {k: IDS["admin"] for k in ("admin", "tpo", "company", "student", "student_established")}):
                path = Path(tmp, "fixtures.json")
                path.write_text(json.dumps(content), encoding="utf-8")
                with self.assertRaises(ValueError):
                    pre.load_fixture_ids(str(path))
        self.assertEqual(pre.load_fixture_ids(), IDS, "the repository's fixture file matches the ids these tests use")

    def test_exit_code_is_0_only_when_all_five_are_ready(self):
        with mock.patch("builtins.print"):
            with mock.patch.object(pre, "run", return_value=([(True, "x", "")], {r: "READY" for r in IDS})):
                self.assertEqual(pre.main(), 0)
            with mock.patch.object(pre, "run", return_value=([(True, "x", "")], {**{r: "READY" for r in IDS}, "admin": "NEEDS_DB_CHECK"})):
                self.assertEqual(pre.main(), 1)
            with mock.patch.object(pre, "run", return_value=([(False, "x", "")], {r: "READY" for r in IDS})):
                self.assertEqual(pre.main(), 1)

    # ---- privacy and scope -------------------------------------------------------------------------

    def test_nothing_private_is_reported(self):
        pool = [account(GOOGLE_UID, EMAIL["admin"]), account(OTHER_UUID, EMAIL["tpo"]), account(IDS["company"], "private.person@example.test")]
        _, _, _, text = self.go(pool, environ=env_for(*IDS))
        for hidden in (TOKEN, HASH, GOOGLE_UID, OTHER_UUID, "PRIVATE-NAME", "private.person", "TEST-PASSWORD-NOT-REAL", "1790000000000"):
            self.assertNotIn(hidden, text)

    def test_only_the_five_fixtures_are_ever_asked_about(self):
        _, _, calls, _ = self.go()
        lookups = [body for method, url, body in calls if url == pre.LOOKUP_URL]
        self.assertEqual(len(lookups), 10)
        asked = sorted(v for body in lookups for values in body.values() for v in values)
        self.assertEqual(asked, sorted([*IDS.values(), *EMAIL.values()]))
        self.assertEqual([(m, u) for m, u, _ in calls[:2]], [("GET", pre.CONFIG_URL), ("GET", pre.TENANTS_URL)])

    def test_the_real_caller_refuses_everything_that_is_not_on_the_list(self):
        refused = [
            ("POST", f"{pre.IDENTITY}/v1/projects/{pre.PROJECT}/accounts", {"email": ["x@example.test"]}),
            ("POST", f"{pre.IDENTITY}/v1/projects/{pre.PROJECT}/accounts:update", {"localId": ["x"]}),
            ("POST", f"{pre.IDENTITY}/v1/projects/{pre.PROJECT}/accounts:delete", {"localId": ["x"]}),
            ("POST", f"{pre.IDENTITY}/v1/projects/{pre.PROJECT}/accounts:batchGet", None),
            ("POST", f"{pre.IDENTITY}/v1/accounts:signInWithPassword", {"email": ["x"]}),
            ("PATCH", pre.CONFIG_URL, {}),
            ("POST", pre.TENANTS_URL, {}),
            ("GET", f"{pre.IDENTITY}/v1/projects/another-project/accounts:lookup", None),
            ("POST", pre.LOOKUP_URL, {"email": ["a@example.test", "b@example.test"]}),
            ("POST", pre.LOOKUP_URL, {"email": ["a@example.test"], "localId": ["x"]}),
            ("POST", pre.LOOKUP_URL, {"phoneNumber": ["+10000000000"]}),
            ("POST", pre.LOOKUP_URL, {}),
            ("POST", pre.LOOKUP_URL, None),
        ]
        with mock.patch.object(pre.urllib.request, "urlopen", side_effect=AssertionError("network must not be reached")):
            for method, url, body in refused:
                with self.assertRaises(PermissionError, msg=f"{method} {url} {body}"):
                    pre.identity_call(method, url, body, TOKEN)

    def test_the_real_caller_sends_the_project_header_and_a_timeout(self):
        seen = {}

        class Reply:
            status = 200

            def read(self):
                return b'{"users": []}'

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def urlopen(request, timeout=None):
            seen.update(url=request.full_url, method=request.get_method(), timeout=timeout,
                        headers={k.lower(): v for k, v in request.header_items()}, body=json.loads(request.data))
            return Reply()

        with mock.patch.object(pre.urllib.request, "urlopen", urlopen):
            self.assertEqual(pre.identity_call("POST", pre.LOOKUP_URL, {"email": [EMAIL["admin"]]}, TOKEN), (200, {"users": []}))
        self.assertEqual((seen["url"], seen["method"], seen["timeout"]), (pre.LOOKUP_URL, "POST", pre.TIMEOUT))
        self.assertEqual(seen["headers"]["x-goog-user-project"], pre.PROJECT)
        self.assertEqual(seen["body"], {"email": [EMAIL["admin"]]})

    def test_source_cannot_change_an_account_or_sign_in(self):
        code = Path(pre.__file__).read_text(encoding="utf-8").split('"""', 2)[2]
        for forbidden in ("signInWithPassword", "signUp", "accounts:update", "accounts:delete", "accounts:batchCreate", "accounts:sendOobCode",
                          "setAccountInfo", "resetPassword", '"PATCH"', '"PUT"', '"DELETE"', "secrets", "shell=True", "os.system", "getpass"):
            self.assertNotIn(forbidden, code, f"'{forbidden}' has no place in a read-only lookup")
        self.assertEqual(code.count("subprocess.run("), 1, "exactly one command: the gcloud token")
        self.assertEqual(len(pre.ALLOWED), 3)
        self.assertEqual(pre.PROJECT, "prooflab-508214")

    def test_error_code_passes_machine_codes_only(self):
        self.assertEqual(pre.error_code({"error": {"message": "INVALID_PROJECT_ID"}}), "INVALID_PROJECT_ID")
        self.assertEqual(pre.error_code({"error": {"message": "User a@b.c not found", "status": "NOT_FOUND"}}), "NOT_FOUND")
        for body in (None, {}, {"error": "text"}, {"error": {"message": "free text with a@b.c"}}, []):
            self.assertEqual(pre.error_code(body), "withheld")


if __name__ == "__main__":
    unittest.main()
