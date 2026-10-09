# S29 — Identity and five-role readiness

Date: 9 October 2026. Base commit: `851cf7ecca4ff92be2e1507cca9476a33c057728`.
Worktree: `prooflabai-claude-s29`, branch `fix/teja-claude-s29-identity-five-role-2026-10-09`.

**Nothing was created, changed or deleted.** No account, no database row, no secret, no deploy, no commit.

## 1. The answer first

| Role | Ready? | The one thing blocking it |
|---|---|---|
| Admin | No | The login and the database mapping are both correct. Only the password is missing from the test run. |
| College / TPO | No | No Identity login exists. |
| Company | No | No Identity login exists. |
| Fresh student | No | No Identity login exists. |
| Established student | No | No Identity login exists. |

Ready today: **0 of 5**.

Good news, measured on staging today: **all five database accounts are healthy.** Role, profile, college or company link and approval are all right. No database repair is needed. The whole blocker is on the Identity side: four missing logins and one password.

## 2. How a sign-in really works

```
sign-in form
   |  email + password
   v
gateway (BFF)  /api/auth/login
   |  1. asks Google Identity: is this email + password right?      -> no: "Invalid login credentials"
   v
auth-bridge  /token
   |  2. turns the Identity id into a database id (migration 05):
   |       id looks like a uuid      -> that uuid IS the database id
   |       any other id              -> looks in table account_identities
   |       no row there              -> makes a NEW empty account
   v
database  web_login_identity(id)   (migration 102)
   |  3. role row? own profile row? college / company? suspended?   -> no: "Account access is managed by ..."
   v
session cookie -> dashboard for that role
```

The email never decides which database account a login becomes. The **Identity id** decides.

## 3. Why the five fixtures cannot sign in

| Role | Step that fails | Why |
|---|---|---|
| TPO, Company, Fresh student, Established student | Step 1 | The fixtures are database rows only. Nobody ever made an Identity login for them. |
| Admin | None of 1 to 3 | See section 4. It is blocked only because no password is supplied to the test. |

## 4. The Admin "UID mismatch"

It is not a fault.

1. The Admin login was made the normal way, so Google gave it its own id (not a uuid).
2. Staging table `account_identities` has a row linking that id to the Admin fixture account. Read today.
3. That fixture account has role `admin`.

So the mismatch S24 and S25 saw is by design: the mapping table bridges it. The Admin login was **not** changed, and should not be.

Still unknown: whether anyone holds its password. If nobody does, do **not** reset it. Use option B in section 7.

One caution: this same login also works on the live site, because the Identity pool is shared. Which account it becomes in production depends on production's own mapping table. That was not read.

## 5. What each role needs in the database

All of these were found correct on staging today.

| Role | Fixture id | Rows required |
|---|---|---|
| Admin | `ffed80fc-…-9432ef2d81f9` | `user_roles.role = admin` |
| TPO | `99999999-0000-…-000000000001` | `user_roles.role = college_admin`; a `colleges` row owned by this id, not suspended, not rejected; it is Staging Fake College |
| Company | `b19ab84b-…-470b2193168e` | `user_roles.role = startup`; a `startups` row owned by this id, not suspended, not rejected |
| Fresh student | `b3786001-…-115f222a8bf1` | `user_roles.role = student`; `student_profiles` row with a name, `status = active`, not blocked, in Staging Fake College; that college active and approved |
| Established student | `99999999-0001-…-000000000001` | Same student rules; its college active and approved |

Not checked by the tool: that the fresh student has no intake yet and the established student has history. Those are test-data states, not sign-in rules.

## 6. The readiness tool

`scripts/dev-tools/teja_s29_role_readiness.py` follows the same three steps and stops at the first refusal.

| Run | What it reads |
|---|---|
| `python scripts/dev-tools/teja_s29_role_readiness.py` | Identity only. Database shows as NOT CHECKED. |
| `python scripts/dev-tools/teja_s29_role_readiness.py --read-staging-db` | Also the staging database. GET only, five fixed tables, fixed columns. |

It prints READY or BLOCKED and a reason per role. It never prints an address, an Identity id, a password or a token. Exit code 0 only at 5 of 5.

Reasons it can give: `IDENTITY_MISSING`, `IDENTITY_AMBIGUOUS`, `IDENTITY_DISABLED`, `IDENTITY_NO_PASSWORD`, `UID_MISMATCH`, `DB_MAPPING_MISSING`, `DB_NOT_CHECKED`, `ACCOUNT_NOT_PROVISIONED`, `WRONG_ROLE`, `PROFILE_MISSING`, `SUSPENDED`, `WRONG_ORGANISATION`, `ORGANISATION_NOT_APPROVED`, `CREDENTIALS_NOT_SUPPLIED`.

Today's result with the database read:

```
ADMIN        BLOCKED  CREDENTIALS_NOT_SUPPLIED   fixture database account: OK
TPO          BLOCKED  IDENTITY_MISSING           fixture database account: OK
COMPANY      BLOCKED  IDENTITY_MISSING           fixture database account: OK
STUDENT      BLOCKED  IDENTITY_MISSING           fixture database account: OK
ESTABLISHED  BLOCKED  IDENTITY_MISSING           fixture database account: OK
IDENTITY_READY_COUNT=0/5
```

**Disclosure.** The database read uses the staging test credential that the existing helper `st.py` makes from the staging signing key in Secret Manager. I ran it once. The credential stayed in memory and was not printed or saved. It asked 23 read questions and wrote nothing.

Tests: `python scripts/dev-tools/test_teja_s29_role_readiness.py` — 32 tests, all pass. They cover UID mismatch, missing identity, wrong role, missing mapping, suspended account, wrong college or company, and the safety rules (staging address only, GET only, no secrets in output).

## 7. Remediation (every step needs the owner's yes; none was run)

### 7.1 Decide first

| Decision | Recommendation |
|---|---|
| Make four staging test logins in the shared pool? | Yes. There is no other way to run a real sign-in. |
| How should each login point at its fixture? | Give the login the fixture's own id. Then no database change is needed at all. |
| Admin | Option A if someone knows the password. Otherwise option B. Never reset the existing login. |

Why the fixture id works: a uuid-shaped Identity id passes straight through the bridge as the database id (section 2, step 2). All five fixture ids are uuid-shaped, and S25 confirmed none of them is used as an Identity id today.

### 7.2 Steps

1. **Owner picks four strong random passwords** and stores each in Secret Manager under a new name, for example `prooflab-staging-e2e-tpo-password`. Never in a file or in chat.
2. **Owner creates four logins**, one per role, with the Identity admin "create account" call. Each sets three things: `localId` = the fixture id from section 5, `email` = the fixture address, and the password. Request shape (no real password shown):

   ```
   POST https://identitytoolkit.googleapis.com/v1/projects/prooflab-508214/accounts
   { "localId": "<fixture id>", "email": "<fixture address>", "password": "<from Secret Manager>", "emailVerified": true }
   ```

   I have not run this call. Try it on one role first (TPO), check, then do the other three.
3. **Admin, option A:** supply the existing login's address and password to the test run. No account change.
   **Admin, option B:** create one extra login with `localId` = the Admin fixture id and a new address (the fixture address is already taken). The existing Admin login stays exactly as it is. Both then open the same staging admin account.
4. **Check without a browser:** set `E2E_<ROLE>_EMAIL` and `E2E_<ROLE>_PASSWORD` for the five roles, then run the tool with `--read-staging-db`. Expect 5 of 5 READY.
5. **Run the real browser test:** `scripts/dev-tools/staging_browser_e2e.mjs` against staging. Only this proves a real sign-in.

### 7.3 Undo

| What | How |
|---|---|
| One test login | Identity admin `accounts:delete` with that `localId`, or disable it. The database fixture is untouched either way. |
| Passwords | Delete the new Secret Manager entries. |

### 7.4 Risks to accept

1. **The logins also work on the live site.** They are refused by the role check once production has the gateway. Today production has no gateway (S25), so a test login could sign in there as a brand-new empty account, the same as any self sign-up. Keep the passwords secret and never use them on `prooflab.co.in`.
2. A first sign-in on production would add one empty row to the production accounts table for that id.
3. Staging still runs an older site and gateway (S27 report). Run the five journeys after the release candidate is deployed to staging, or the result describes old code.

## 8. What can be verified with no account change

| Can be verified now | Done? |
|---|---|
| Which fixture addresses have an Identity login | Yes: 1 of 5 |
| That the Admin login maps to the Admin fixture | Yes |
| That all five database accounts would pass the sign-in rules | Yes |
| The sign-in rules themselves, case by case | Yes: 32 tests |
| Signed-out behaviour of staging | Yes (S24, S27) |

| Cannot be verified without a real login | |
|---|---|
| That a password is accepted | Needs a real password |
| That the session cookie is set and each dashboard opens | Needs a real sign-in |
| The four menus and their inner tabs for each role | Needs a real sign-in |

## 9. Not touched

Identity accounts, including the existing Admin login. The staging and production databases. Secrets, IAM, Cloud Run, Hosting. Application, dashboard and gateway code. The S23, S24, S25, S27, BASH R2 and SIDHU worktrees. Navigation is unchanged because no application file was edited.

## 10. Files

| File | What |
|---|---|
| `scripts/dev-tools/teja_s29_role_readiness.py` | Read-only readiness tool |
| `scripts/dev-tools/test_teja_s29_role_readiness.py` | 32 tests |
| `docs/teja-release/S29-IDENTITY-AND-FIVE-ROLE-READINESS.md` | This report |
