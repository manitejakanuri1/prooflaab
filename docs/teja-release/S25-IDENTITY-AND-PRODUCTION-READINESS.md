# S25 — Identity and production readiness

Date: 9 Oct 2026. Base commit: `851cf7ecca4ff92be2e1507cca9476a33c057728`.
Branch: `fix/teja-claude-s25-identity-prod-readiness-2026-10-09`. Mode: **read-only**.

**Answer first: launch is still NO-GO.** No real signed-in browser test has run, and production cannot take the BFF yet.

What this work settles:

| Question | Answer | How sure |
|---|---|---|
| Why does the tenant list return HTTP 400? | Multi-tenancy is not switched on in this project. | High |
| Are there test logins hidden in other tenants? | No sign of any tenant. None can exist while tenancy is off. | High, not absolute |
| What is the Admin mismatch? | The address has a real login, but its id was made by Google. It is not the fixture id. | Verified |
| Can the five fixtures be signed in to today? | No. 0 of 5 are ready. | Verified |
| Is there a production BFF? | No. | Verified |
| Are migrations 95 to 102 on production? | Could not be read safely. Indirect signs say no. | Not verified |

What was NOT done: no account created or changed, no password read, no sign-in tried, no IAM change, no secret
value read, no deploy, no traffic change, no database read or write, no commit.

How the evidence was collected:

- Google Identity Platform admin API: project configuration (GET), tenant list (GET), and `accounts:lookup`
  for the five fixture addresses and five fixture ids only. `accounts:lookup` is a query; it writes nothing.
- `gcloud run services list` and `gcloud secrets list` (names only).
- Firebase Hosting release list (rewrite rules only).
- Anonymous HTTP GETs.
- Only yes/no facts were printed. No token, Identity id, password hash or other account field was shown.

---

## 1. Identity findings

### 1.1 How a login becomes a database account (from the code)

A fixture is a row in the **staging database**. A login is an account in **Google Identity Platform**.
They are different things. The auth-bridge joins them (`auth-bridge/main.ts`, `resolve_account_uuid` in migration 05):

| Identity id looks like | Database id used |
|---|---|
| a uuid | that same uuid, in every database |
| anything else (Google-made) | whatever the table `account_identities` **of that database** says |
| anything else, no row yet | a brand-new random id, created at first sign-in |

So "the address exists in Identity" does not mean "the fixture can sign in". The id decides.

### 1.2 Project configuration (live)

| Setting | Value |
|---|---|
| Product | Identity Platform |
| Email + password sign-in | Enabled, password required |
| Other sign-in providers | None configured |
| Multi-factor | Disabled |
| Multi-tenancy (`allowTenants`) | Not set, so **off** |
| Self sign-up blocked at Identity level | **No** (no client permission is set) |
| Authorized domains | 5; **the staging site is not one of them** |

### 1.3 The tenant list error

- Call: `GET /v2/projects/prooflab-508214/tenants`, with `x-goog-user-project`.
- Answer: HTTP 400, status `INVALID_ARGUMENT`, message `INVALID_PROJECT_ID`.
- The project id is right and the credential works: the same credential read the configuration and ran the lookups.
- The configuration has no `allowTenants`. The one account found has no tenant id.
- Conclusion: the tenant API refuses this project because tenancy is off. It is not a permission fault.
- Limit: Google's exact wording for "tenancy off" was not checked against Google's documentation. If tenancy was ever switched on and off again, old tenants cannot be listed from here.

Other tenants cannot be enumerated safely, and there is nothing to enumerate. Switching tenancy on just to look would change the production project. It was not done.

### 1.4 The five fixtures (default tenant, live)

Tool: `python scripts/dev-tools/identity_fixture_preflight.py`. Result: **0 of 5 READY**.

| Role | Address has a login | Fixture id is a login | Category | Verdict |
|---|---|---|---|---|
| Admin | Yes | No | `EMAIL_ONLY_GOOGLE_UID` | NEEDS_DB_CHECK |
| College / TPO | No | No | `ABSENT` | NOT_READY |
| Company | No | No | `ABSENT` | NOT_READY |
| Fresh student | No | No | `ABSENT` | NOT_READY |
| Established student | No | No | `ABSENT` | NOT_READY |

No `E2E_*` login variables are set on this machine for any role.

### 1.5 The Admin mismatch, exactly

- One login has the Admin fixture address. It is enabled, has a password, has signed in before, and was created in October 2026.
- Its id is a Google-made id (not uuid-shaped). The fixture id `ffed80fc-…81f9` is **not** an Identity id at all.
- So this is not a wrong account with a clashing uuid. It is a normal Google-id login.
- Whether it signs in **as the Admin fixture** depends on one row in staging's `account_identities`. That table was not read (it needs a service credential).
- Nothing else about that account was read or shown.

One read-only query settles it (owner or TEJA, staging only):

```
python scripts/dev-tools/st.py svc GET "account_identities?select=user_id&email=eq.e2e.admin@staging.prooflab.invalid"
```

- Returns `ffed80fc-08ee-4cce-ac54-9432ef2d81f9`: the login **is** the Admin fixture. Only the password is then needed.
- Returns another id, or nothing: the login is a different account. It must not be edited without the owner's "yes".

### 1.6 Two side findings

1. **Self sign-up is open at Identity level.** Anyone with the public browser key can create a login in the shared pool.
   The BFF refuses sign-up and refuses sign-in for accounts that are not managed, so staging is protected.
   The current production site has no BFF yet. Owner should decide whether to block sign-up in Identity itself.
2. **The staging site is not an authorized domain.** Password-reset and verify-email links that return to
   `prooflab-staging.web.app` are likely to be refused by Google. Plain email + password sign-in is not affected.
   This was read from configuration, not tested.

---

## 2. Staging test logins: three ways

| | A. Approved logins in the shared pool | B. Separate staging tenant | C. Separate staging Identity project |
|---|---|---|---|
| Changes production Identity settings | No | **Yes** (tenancy switched on for the shared project) | No |
| Code changes | None | BFF, auth-bridge and accounts service | None expected (project id is already a setting) |
| Isolation from production | Weak: the login also works on the live site, as an account with no data | **Unsafe as-is**: the production bridge checks issuer and project only, so it would accept a staging-tenant token | Strong: production rejects the token |
| Tests the real production Identity setup | Yes | Partly | No |
| Effort | About 1 hour | Days | Half a day to a day |
| Undo | Delete the logins | Hard | Point staging back |

**Recommendation: A now, C afterwards.**

- A is the smallest safe step. It adds no power an outsider does not already have, because sign-up is open (1.6).
- C is the proper fix. It needs no production change. Do it before test accounts multiply.
- B is not recommended. It changes the production project and needs a bridge change first.

### Approach A, exact steps (nothing here was executed; every step needs the owner's "yes")

1. Run the Admin query in 1.5.
2. Create four logins (TPO, Company, Student, Established) **with the Identity id set to the fixture id**. Then no database row is needed, and the mapping is the same everywhere.
3. Admin: if the query matched, reuse the login. If not, the owner chooses: a new Admin fixture address, or one mapping row in staging.
4. Use long random passwords. Store them in Secret Manager only, under staging names.
5. Pass them to the tests as `E2E_<ROLE>_EMAIL` and `E2E_<ROLE>_PASSWORD` at run time.
6. Re-run `identity_fixture_preflight.py`. It must show 5 of 5 READY.
7. Run `staging_browser_e2e.mjs` against `https://prooflab-staging.web.app`.

Constraints:

- The five logins also exist for the live site. There they have no rows. With the BFF, sign-in is refused. Without it (today), the bridge would create an empty account row on first sign-in. Do not sign in to production with them.
- Step 2 relies on the admin API accepting a chosen id. Confirm with one login first.
- Never reuse a real person's address.

---

## 3. Production launch blockers

Tool: `python scripts/dev-tools/production_bff_preflight.py`. Result today: **6 of 19 PASS, verdict FAIL** (correct: production is not ready).

| # | Requirement | Live today | Status |
|---|---|---|---|
| 1 | Service `prooflab-web-bff` exists | Not deployed. Only `prooflab-staging-web-bff` exists, and it is not accepted. | BLOCKER |
| 2 | Website `/api/**` goes to the BFF | Production Hosting has one rule only: everything goes to the app page. `/api/auth/session` returns HTML. | BLOCKER |
| 3 | Auth-bridge signs with its own key | `APP_SIGNING_KEY` not set. `/service-token` therefore answers 401. | BLOCKER |
| 4 | Bridge lists the BFF as a caller | `SERVICE_TOKEN_AUDIENCE` and `SERVICE_TOKEN_CALLERS` not set | BLOCKER |
| 5 | Production secrets exist | No production signing-key secret. No production BFF session-key secret. Only staging ones exist. | BLOCKER |
| 6 | Migrations 95 to 102 applied | Not verified (see 3.1) | UNKNOWN |
| 7 | Five production backends healthy | All five answer their health contract | OK |
| 8 | Suspended-account guard on the API | Present (`refuse_suspended` is visible on the production API) | OK |

### 3.1 Migrations 95 to 102

- The ledger table `schema_migrations` and every object these migrations create are readable by the service role only.
- Reading them needs a production service token made from the production signing secret. That was not done.
- Indirect signs: the production API shows 77 public objects, staging shows 166. No document records 95 to 102 on production. No production BFF exists to need them.
- Verdict: **NOT VERIFIED; very likely not applied.**
- Working proof later: the production BFF's `/ready` returning 200 "ready" proves the session table and service token work.

### 3.2 What the production BFF must look like

| Topic | Requirement |
|---|---|
| Name and place | `prooflab-web-bff`, `asia-south1`, deployed by image digest |
| Identity | Its own new service account. No project-level roles. Not shared with any service. |
| Secret access | Read access to one secret only: a new production session key |
| Session key | New 32-byte key, production only. Never the staging key. |
| Upstreams | The six production services only: auth-bridge, api, functions, files, accounts, transcriber |
| Browser origins | `https://prooflab.co.in` plus production Hosting addresses. https only. No staging, no localhost. |
| Invoker | Public (`allUsers`). Hosting must reach it. Its protection is its own sign-in, CSRF guard and cookie. |
| Ingress | All. Same reason. |
| Traffic | 100% pinned to one named revision |
| Release switch | `BFF_RELEASE_READY` off at first, then on. `/ready` must then return 200. |

The preflight checks: name and place, own unshared account, session key reference, upstreams, origins, public invoker, pinned traffic and `/ready`.
It does not check: the image digest, ingress, or the IAM roles and secret access of the account.

### 3.3 Order of work, with what each step depends on

| Step | Action | Depends on | Proof |
|---|---|---|---|
| 1 | Owner decides the 4 open drift items; refresh `infra/` | — | `infra_snapshot.py --check` exits 0 |
| 2 | Five-role signed-in E2E passes on staging | Section 2 | results file, 0 failures |
| 3 | Back up the production database | — | backup listed |
| 4 | Apply migrations 95 to 102 to production, in order | 3 | each self-check passes |
| 5 | Production signing change: new signing-key secret; bridge gets `APP_SIGNING_KEY`, audience, callers; API moves to the bridge's public keys | 3 | bridge `/ready` says RS256; existing sign-in still works |
| 6 | Create BFF account, session-key secret, and the service (3.2) | 4, 5 | preflight: service, config and bridge checks PASS |
| 7 | Switch `BFF_RELEASE_READY` on | 6 | `/ready` 200 "ready" |
| 8 | Owner sets approved release commit and the BFF address variables | 7 | release guard passes |
| 9 | Publish the website (rule `/api/**` first, app page last) | 8 | `production_bff_preflight.py` all PASS |
| 10 | Smoke test: sign in, dashboard, sign out; `healthcheck.py` | 9 | all PASS |

### 3.4 Rollback

| If this breaks | Do this | Time |
|---|---|---|
| Website after step 9 | Re-release the previous Hosting version | about 1 minute |
| BFF revision | Send traffic back to the previous revision | about 1 minute |
| Sign-in after step 5 | Remove `APP_SIGNING_KEY` from the bridge; restore the API's previous key setting | about 2 minutes |
| A migration | Run its `migration/NN-rollback-*.sql`, newest first | per migration |
| Suspended-account guard | Remove `PGRST_DB_PRE_REQUEST` from the API **before** rolling back migration 73 | about 2 minutes |

Step 5 is the riskiest step. It changes how every production token is signed. Do it alone, at a quiet hour, with its rollback ready.

### 3.5 Risk from the 4 open drift items

| Item | Risk if left open |
|---|---|
| Production `prooflab-functions` image not in the manifest, deployed by tag | The tag can be moved. Nobody can prove which code is live. A rollback has no recorded target. |
| Runner `prooflab-code-runner-rc`, same | Same. This service runs student code, so an unknown image matters most here. |
| Production job `prooflab-bug-finder` image not in the manifest | Low. It only reads the site as a test user. |
| Staging functions use the production email key | Staging tests can send real email from the production account and use its quota. A leak on staging exposes the production key. |

None of the four blocks the staging E2E. All four should be closed before step 4.

---

## 4. GO / NO-GO

| # | Criterion | Now |
|---|---|---|
| 1 | Identity preflight: 5 of 5 READY | NO (0 of 5) |
| 2 | Five-role signed-in browser E2E passes on staging | NO (blocked by 1) |
| 3 | Staging canary `/ready` seen at 200 with the switch on | NOT DONE |
| 4 | Drift: 0 open items | NO (4 open) |
| 5 | Production migrations 95 to 102 applied | NOT VERIFIED |
| 6 | Production preflight: all PASS | NO (6 of 19) |
| 7 | Owner-approved release commit; release guard passes | NO |
| 8 | Smoke sign-in on the live site after publish | NOT DONE |

Any "NO" means NO-GO. **A launch must not be declared ready without criterion 2.**

## 5. Owner decisions needed

1. Approve Approach A: four new staging test logins in the shared pool, ids set to the fixture ids.
2. Admin login: allow the one read-only staging query in 1.5, then decide reuse or replace.
3. Whether to block self sign-up at Identity level.
4. Whether to add the staging site as an authorized domain.
5. Whether to plan a separate staging Identity project (Approach C).
6. The 4 open drift items.
7. Go-ahead for production steps 3 to 5 (backup, migrations, signing change).
8. The approved production release commit.

## 6. Files in this change

| File | What |
|---|---|
| `scripts/dev-tools/identity_fixture_preflight.py` | Read-only check of the five fixture logins |
| `scripts/dev-tools/test_identity_fixture_preflight.py` | 25 unit tests, no network |
| `scripts/dev-tools/production_bff_preflight.py` | Read-only production readiness check |
| `scripts/dev-tools/test_production_bff_preflight.py` | 27 unit tests, no network |
| `docs/teja-release/S25-IDENTITY-AND-PRODUCTION-READINESS.md` | This report |
