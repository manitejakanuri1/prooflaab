# S24 — Infrastructure audit and launch preflight

Date: 9 Oct 2026. Base commit: `13771d257eafa5ae4ec8a250cbf2c35c66eb678f`.
Branch: `fix/teja-claude-s24-infra-preflight-2026-10-09`. Mode: **read-only**.

**Answer first: launch is NO-GO today.** Staging BFF canary is healthy. Production cannot take the BFF yet.

What was done:

1. All 16 infrastructure differences were compared with live cloud, one by one.
2. A read-only staging preflight tool was written, unit tested (26 tests) and run live (30 of 30 checks passed).
3. Browser E2E blockers and the production routing plan were worked out from the source.

What was NOT done: no deploy, no traffic change, no database write, no snapshot rewrite, no secret read,
no login attempt, no account created, no commit.

How the evidence was collected: `gcloud ... list / describe / get-iam-policy` and
`gcloud secrets versions list` (version numbers and state only), plus anonymous HTTP GETs.
No setting value was printed. Settings are described by name, kind (plain or secret reference) and length.

---

## 1. The 16 differences

Legend:

- **VERIFIED** — explained by evidence; safe to record in `infra/`.
- **NEEDS_OWNER_APPROVAL** — real and understood, but someone must say "yes, this is intended" first.
- **UNRESOLVED** — cannot be explained from evidence available here.

Every image difference is a **genuinely different image** (different sha256 digest), not just a renamed tag.
Each was resolved to its digest with `gcloud artifacts docker images describe`.

### Production (10)

| # | Object | Stored in `infra/` | Live now | Finding | Verdict |
|---|---|---|---|---|---|
| 1 | job `prooflab-bug-finder` | image `:v22` (`2e6a49d1…`) | `:prod-e3bf417` (`6ffa12fa…`) | New image. Tag names commit `e3bf417` "Fix production bug finder navigation" (7 Oct), which is in this branch's history. Digest is **not** in `docs/RELEASE-MANIFEST.md`. | NEEDS_OWNER_APPROVAL |
| 2 | job `prooflab-crawler` | `:agent-reach-da5044d-6` (`02245c6a…`) | pinned digest `a1f5f74d…` | Live digest **is** listed in `docs/RELEASE-MANIFEST.md`. Snapshot is stale. | VERIFIED |
| 3 | scheduler `prooflab-transcription-reap` | headers `Content-Type`, `User-Agent`, `x-webhook-secret` | `User-Agent`, `x-webhook-secret` | Only `Content-Type` is gone. The secret header is still sent. Job is ENABLED, runs every minute, last attempt succeeded (no error code). The function does not read a request body. Job was last edited 7 Oct 03:20 UTC, when the webhook secret was rotated. | VERIFIED |
| 4 | service `prooflab-accounts` | image `:v2`; `WEBHOOK_SECRET` = `webhook-secret:latest` | digest `7c1e20b0…`; `WEBHOOK_SECRET` = `webhook-secret:2` | Image digest is in the release manifest (it is the image staging ran as `stab-93675c0`). Secret: still the same Secret Manager secret, now pinned to version 2. Version 2 is the only enabled version (version 1 is disabled), so `:2` and `:latest` are the same value today. | VERIFIED |
| 5 | service `prooflab-api` | no `PGRST_DB_PRE_REQUEST` | `PGRST_DB_PRE_REQUEST` set | Live value equals `public.refuse_suspended` (compared in code, not printed). This is step 1 of `docs/PRODUCTION-ROLLOUT-CHECKLIST.md` and is described in `docs/PRODUCTION-ARCHITECTURE.md`. It is a security guard being **added**, not removed. | VERIFIED |
| 6 | service `prooflab-auth-bridge` | digest `1f082fda…` | digest `fa15be73…` | Live digest is in the release manifest. Settings are unchanged. | VERIFIED |
| 7 | service `prooflab-files` | `:v-no-vercel` (`7946c270…`) | digest `956658b4…` | Live digest is in the release manifest. | VERIFIED |
| 8 | service `prooflab-functions` | digest `b101fcdc…`; `WEBHOOK_SECRET` = `:latest` | `:prod-444b2f3` (`08282807…`); `WEBHOOK_SECRET` = `:2` | Secret: same as row 4. Image: tag names commit `444b2f3` "B2-C: handle output-limit verdict in coding UI" (7 Oct), in this branch's history. Digest is **not** in the release manifest. Deployed by a mutable tag, not a digest. | NEEDS_OWNER_APPROVAL |
| 9 | service `prooflab-transcriber` | `:v1` (`29443fe1…`) | digest `357b1399…` | Live digest is in the release manifest. | VERIFIED |
| 10 | service `prooflab-transcription-worker` | `:g1w`; no instance limit | digest `a148d99b…`; max instances 3 | Digest is in the release manifest. A limit was added where there was none; `docs/CLOUD-CAPACITY-PLAN.md` asks for a limit (it says 4, live is 3). Invoker is still only `prooflab-tasks-invoker`. | VERIFIED (confirm 3 vs 4) |

### Staging (5)

| # | Object | Stored in `infra/` | Live now | Finding | Verdict |
|---|---|---|---|---|---|
| 11 | service `prooflab-staging-accounts` | `:stab-93675c0`; no `SITE_URL` | `:stab-f2a746a` (`675748b0…`); `SITE_URL` added | Tag names commit `f2a746a` "security: rollback failed managed account provisioning" (8 Oct). `SITE_URL` is https and names the staging site. T12 lists this exact change as planned. | VERIFIED |
| 12 | service `prooflab-staging-auth-bridge` | 5 service-token callers | 6 callers | The one added caller is the service account of `prooflab-staging-web-bff`. Nothing was removed. All 6 callers are identities of staging services. The BFF needs this to read its session store. | VERIFIED |
| 13 | service `prooflab-staging-code-runner` | `:stab-93675c0` | `:b2a-079c181` (`f280b0bd…`) | Tag names commit `079c181` "C2 B2-A: support IAM runner smoke tests" (7 Oct). Invoker is only the staging functions account. | VERIFIED |
| 14 | service `prooflab-staging-functions` | `:stab-e4e2922`; no `RESEND_API_KEY`, no `SITE_URL` | `:stab-f545fb6` (`c2408997…`); `RESEND_API_KEY` = `resend-api-key:2`; `SITE_URL` added; `EMAIL_FROM` changed | Image: commit `f545fb6` "fix: report managed invitation delivery truthfully" (8 Oct). `SITE_URL`: fine, as row 11. **`RESEND_API_KEY` points at `resend-api-key`, the same secret production uses.** Staging can now send real email on the production email account. `EMAIL_FROM` moved to a different sender domain. | NEEDS_OWNER_APPROVAL |
| 15 | service `prooflab-staging-web-bff` | not recorded at all | exists | See section 2. Own service account with **no** project-level roles; it can read only its own session-key secret. `SESSION_KEY` is a secret reference. All upstream addresses are staging. Public invoker (`allUsers`), which a browser gateway needs. | VERIFIED |

### Runner project (1)

| # | Object | Stored in `infra/` | Live now | Finding | Verdict |
|---|---|---|---|---|---|
| 16 | service `prooflab-code-runner-rc` | digest `01105361…` | `:prod-444b2f3` (`9da176ed…`) | **Invocation security is unchanged**: invokers are exactly the production and staging functions accounts, same as the snapshot. Identity unchanged. Image is new, same commit tag as row 8, and **not** in the release manifest. Deployed by mutable tag. | NEEDS_OWNER_APPROVAL |

### Summary

| Verdict | Count | Rows |
|---|---|---|
| VERIFIED | 12 | 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15 |
| NEEDS_OWNER_APPROVAL | 4 | 1, 8, 14, 16 |
| UNRESOLVED | 0 | — |

Dangerous-change review:

| Area | Result |
|---|---|
| Identity (service accounts) | No service changed its account. |
| Ingress / invokers | No change against the snapshot. The private worker and both runners are still private. |
| Webhook secret | Same secret, pinned to its only enabled version. Not weakened. |
| JWT / signing keys | No change in any drifted object. |
| Cloud SQL attachment | No change. |
| Service-token callers | One staging caller added (the staging BFF). Expected. |
| Cross-environment secret | **Found: staging functions use the production `resend-api-key`** (row 14). |

One limit: this audit proves what an image tag *claims* (a commit id in the tag). It cannot prove the
image was really built from that commit. Rows 1, 8 and 16 need a person who made those deploys to confirm.

### Minimal corrections (not executed)

1. Rows 1, 8, 16: owner confirms the three images, then adds their digests to `docs/RELEASE-MANIFEST.md` and re-points the services at the digest instead of the tag.
2. Row 14: owner decides. Either give staging its own Resend key (`prooflab-staging-resend-api-key`), or accept the shared key in writing.
3. Row 10: confirm 3 is the intended limit (the capacity plan says 4).
4. Only after 1 to 3: run `python scripts/infra_snapshot.py` once to record the reviewed state, and commit `infra/`.
   **Do not run it before**, or the four open items are silently accepted.

---

## 2. Live staging findings

Tool: `python scripts/dev-tools/staging_bff_preflight.py` (read-only). Result on 9 Oct 2026: **30 of 30 PASS**.

| Group | Check | Result |
|---|---|---|
| Identity | Service name, region, own service account in the project | PASS |
| Traffic | `prooflab-staging-web-bff-00004-9nn` takes 100%, pinned (not "latest") | PASS |
| Traffic | Tag `s23` points at `prooflab-staging-web-bff-00005-wuh` and takes 0% | PASS |
| Config | Release switch `BFF_RELEASE_READY` is off | PASS |
| Config | `SESSION_KEY` is a secret reference | PASS |
| Config | All 6 upstream addresses are staging https `run.app` addresses | PASS |
| Config | Staging site is an allowed browser origin; no http origin | PASS |
| Canary | `/health` 200 JSON | PASS |
| Canary | `/ready` 503 JSON (closed) | PASS |
| Canary | Anonymous `/api/auth/session` 200, no session | PASS |
| Canary | Anonymous `/api/db/profiles` and `/api/files/...` 401 JSON | PASS |
| Canary | Unknown path 404 JSON | PASS |
| Stable | Old revision still answers the session route; `/ready` 503 | PASS |
| Site | `https://prooflab-staging.web.app/api/**` returns BFF JSON, not the app page | PASS |
| Upstreams | auth-bridge, functions, accounts, transcriber `/ready` 200; files own 404 | PASS |

Other facts seen live:

- The canary image is `prooflab-web-bff:stab-13771d2`, digest `d55d2b87…`.
- On the canary, `/healthz` returns Google's own HTML 404. This confirms why `/health` was needed.
- The old revision (`00004`) has no `/health` route (it answers the BFF's own JSON 404). Expected for the old image.
- The canary has not been given `BFF_RELEASE_READY`, so `/ready` has never been seen open against real backends.

What the tool does not check: signed-in behaviour, POST routes, the database, and Cloud Run invoker policy.

---

## 3. Browser E2E readiness

How the browser tests sign in: the site's own form, then `/api/auth/login`, then the HttpOnly `__session` cookie
(`scripts/dev-tools/bff_login.mjs`). Each role needs `E2E_<ROLE>_EMAIL` and `E2E_<ROLE>_PASSWORD`.

| Role | Variables | Set on this machine | Fixture data row |
|---|---|---|---|
| Admin | `E2E_ADMIN_EMAIL` / `_PASSWORD` | No | `ffed80fc-…81f9` |
| College / TPO | `E2E_TPO_EMAIL` / `_PASSWORD` | No | `99999999-0000-…0001` |
| Company | `E2E_COMPANY_EMAIL` / `_PASSWORD` | No | `b19ab84b-…168e` |
| Fresh student | `E2E_STUDENT_EMAIL` / `_PASSWORD` | No | `b3786001-…8bf1` |
| Established student | `E2E_ESTABLISHED_EMAIL` / `_PASSWORD` | No | `99999999-0001-…0001` |

- All five are missing on this machine: **zero** `E2E_*` variables are set.
- `docs/STAGING-TEST-FIXTURES.md` says the fixtures have data rows but no Identity login.

**Identity Platform lookup (run by TEJA, read-only, reported 9 Oct 2026).** Project `prooflab-508214`,
`x-goog-user-project` set, **default tenant only**. This lookup was not run or repeated in S24.

| Role | Result in the default tenant | Usable for E2E |
|---|---|---|
| Admin | Reported as "UID/email mismatch": a record was found, but its user id and email do **not** both match the fixture | No |
| College / TPO | Not found | No |
| Company | Not found | No |
| Fresh student | Not found | No |
| Established student | Not found | No |

Exact fixture matches: **0 of 5**.

What this does and does not prove:

- It proves that no fixture has a matching login in the **default tenant**.
- It does **not** prove there are no such accounts in **other tenants**. That was not checked.
- Passwords were not read. No real sign-in was tried. So "can sign in" is still unverified for every role.
- The Admin mismatch needs a decision of its own: the existing login cannot simply be reused, because the
  fixture's data rows belong to a different user id. Do not edit or delete that login without the owner's "yes".

No account was created, changed or deleted. No IAM was changed. No credential was retrieved.

Prerequisites for the full signed-in run, in order:

1. **Owner decision.** Staging and production share one Identity pool, so a staging test login also works on the live site.
2. Five dedicated test logins exist, with the **same user ids** as the fixture rows above (otherwise the login has no data).
3. Each has a `web_login_identity` answer of `allowed = true` with the right role, on staging.
4. The five logins are refused on production (no production rows), or the owner accepts that risk in writing.
5. Passwords live in Secret Manager only, and are passed to the test as environment variables at run time.
6. Playwright browsers installed; `E2E_BASE=https://prooflab-staging.web.app`.

What can run today, and what cannot:

| Test | Needs a login | Status today |
|---|---|---|
| `staging_bff_preflight.py` (this work) | No | RUN, 30/30 PASS |
| BFF unit tests, release guard tests | No | RUN in CI, PASS |
| `attack_surface_check.py` (anonymous) | No | Can run |
| `four_dashboards_mock_browser.mjs` (mocked data) | No | Can run |
| `staging_browser_e2e.mjs` (31 steps, 5 roles) | Yes | **BLOCKED** |
| `staging_screen_walk.mjs` | Yes | **BLOCKED** |
| `bff_cookie_session_e2e.mjs` (login, logout, suspension) | Yes | **BLOCKED** |
| `staging_admin_task_delete_browser.mjs`, voice and scratchpad browser tests | Yes | **BLOCKED** |

---

## 4. Production routing plan

Facts today (verified live):

- `https://prooflab.co.in/api/auth/session` returns the app's HTML page, not JSON.
- No `prooflab-web-bff` service exists. The only BFF is `prooflab-staging-web-bff`.
- **The production auth-bridge has no `APP_SIGNING_KEY`** (it still signs with the shared secret). In that mode its
  `/service-token` route answers 401 by design. The BFF session store needs that route. So the BFF **cannot work in
  production until the production signing change (F1) is done**. This is the biggest hidden prerequisite.
- Whether migrations 95 to 102 (session table, login rule, session revocation) are applied to production was not checked (no database access here).

Nothing below was executed. Every step needs the owner's "yes".

### Stage A — prerequisites (before any BFF deploy)

| # | Step | Proof |
|---|---|---|
| A1 | Close the 4 open drift items (section 1) and refresh `infra/` | `infra_snapshot.py --check` exits 0 |
| A2 | Back up production database | backup listed |
| A3 | Apply migrations 95 to 102 to production, in order | each migration's own self-check passes |
| A4 | Production auth-bridge: add `APP_SIGNING_KEY` (new production secret, readable by the bridge account only), `SERVICE_TOKEN_AUDIENCE`, `SERVICE_TOKEN_CALLERS`; move the API to the bridge's public keys (rollout checklist row 6.1) | `/ready` shows `alg: RS256`; existing sign-in still works |
| A5 | Full signed-in staging E2E has passed (section 3) | results file, 0 failures |

### Stage B — create the production BFF (no user traffic yet)

| Topic | Requirement |
|---|---|
| Service | `prooflab-web-bff`, region `asia-south1`, image = the exact digest proven on staging (`d55d2b87…`), deployed **by digest** |
| Identity | New account `prooflab-rt-webbff@prooflab-508214`. **No project-level roles.** |
| Secret access | Only `secretAccessor` on one new secret, `prooflab-web-bff-session-key` (32 random bytes, production only, never the staging key) |
| Service token | Add only this account to the production bridge's `SERVICE_TOKEN_CALLERS` |
| Upstreams | The six production `run.app` addresses only: `prooflab-auth-bridge`, `-api`, `-functions`, `-files`, `-accounts`, `-transcriber` |
| No staging links | No address containing `prooflab-staging-`. No staging secret. No staging database. |
| Origins | `BROWSER_ORIGINS` = `https://prooflab.co.in` and the production Hosting addresses only. https only. No staging site, no localhost. |
| Access | Public invoker (`allUsers`): Hosting must reach it. Its protection is its own auth, CSRF guard and session cookie. |
| Limits | Same as staging: 1 CPU, 512 Mi, timeout 60 s, max instances set |
| Release switch | `BFF_RELEASE_READY` **not set** at first |

Checks after Stage B (direct `run.app` address, no user traffic):

1. `/health` returns 200 `{"ok":true,"service":"prooflab-web-bff"}`.
2. `/ready` returns 503.
3. Anonymous `/api/auth/session` returns 200 `{"session":null}`; `/api/db/profiles` returns 401.
4. Set `BFF_RELEASE_READY=true`. `/ready` must return **200 with state `ready`**. If it lists a failed name, fix that and do not go on.
5. One real sign-in with the smoke student through the direct address.

### Stage C — route the website

| # | Step | Detail |
|---|---|---|
| C1 | Owner sets repository variables | `PRODUCTION_BFF_SERVICE=prooflab-web-bff`, `PRODUCTION_BFF_HEALTH_URL=<the service's https run.app address>`, `PRODUCTION_RELEASE_APPROVED_SHA=<full 40-character commit>` |
| C2 | Release guard runs (already in `deploy.yml`, before Publish) | Refuses unless: exact service name, region, https `run.app` address, not staging, real build, not a staging build, approved commit equals the commit being published, `/health` answers as `prooflab-web-bff` |
| C3 | Publish | `scripts/deploy-hosting.py` writes the `/api/**` rewrite **first** and the app catch-all (`**` to `/index.html`) **last**. Order is already correct in the code. |
| C4 | Smoke tests on `https://prooflab.co.in` | `/api/auth/session` is JSON, not HTML. Smoke student signs in, opens the dashboard, signs out. `python scripts/healthcheck.py` all PASS. |

### Rollback

| Problem | Action | Time |
|---|---|---|
| Site broken after C3 | Re-release the previous Hosting version (Firebase console, Hosting, release history) | about 1 minute |
| BFF revision bad | Route traffic back to the previous BFF revision | about 1 minute |
| Sign-in broken after A4 | Remove `APP_SIGNING_KEY` from the bridge and restore the API's previous key setting | about 2 minutes |
| Migration problem | Run the matching `migration/NN-rollback-*.sql`. For 73, remove `PGRST_DB_PRE_REQUEST` from the API **first**. | per migration |

Risks:

1. A4 changes how every production token is signed. It is the riskiest step and must be done alone, with its own rollback ready.
2. After C3 the old site build must not be re-published without the rewrite. The release guard prevents this.
3. Session cookies are new in production: every user signs in again once.

---

## 5. GO / NO-GO

**Today: NO-GO for public launch.**

GO for **promoting the staging canary** needs all of:

| # | Criterion | Now |
|---|---|---|
| S1 | `staging_bff_preflight.py` passes | PASS (30/30) |
| S2 | CI green on the release commit | PASS (reported by TEJA) |
| S3 | Canary `/ready` seen at 200 with the switch on, against real staging backends | NOT DONE |
| S4 | Five-role signed-in browser E2E passes on staging | BLOCKED (0 of 5 fixtures have a matching login in the default tenant) |

GO for **production** needs all of:

| # | Criterion | Now |
|---|---|---|
| P1 | S1 to S4 all pass | NO |
| P2 | Drift: 0 open items, `infra_snapshot.py --check` exits 0 | NO (4 need the owner) |
| P3 | Production database backed up; migrations 95 to 102 applied | NOT VERIFIED |
| P4 | Production auth-bridge signs with its own key and serves `/service-token` | NO |
| P5 | `prooflab-web-bff` exists; `/health` 200; `/ready` 200 with the switch on | NO (service does not exist) |
| P6 | Owner has set the approved release commit; release guard passes | NO |
| P7 | Rollback steps rehearsed on staging | NOT DONE |
| P8 | After publish: `/api/auth/session` on `prooflab.co.in` is JSON; smoke sign-in works; `healthcheck.py` all PASS | NOT DONE |

Any single "NO" means NO-GO.

## 6. Owner decisions needed

1. Confirm the three production images not in the release manifest (rows 1, 8, 16).
2. Staging using the production email key (row 14): separate key, or accept.
3. Worker instance limit: 3 or 4 (row 10).
4. Whether to create staging test logins in the shared Identity pool (four are missing in the default tenant), and what to do about the Admin login whose user id and email do not match the fixture.
5. Go-ahead for the production signing change (A4) and migrations (A3).
6. The approved production release commit.

## 7. Files in this change

| File | What |
|---|---|
| `scripts/dev-tools/staging_bff_preflight.py` | The read-only preflight |
| `scripts/dev-tools/test_staging_bff_preflight.py` | 26 unit tests, no network |
| `docs/teja-release/S24-INFRA-AND-LAUNCH-PREFLIGHT.md` | This report |


## 8. Independent static-review amendment (reviewed package)

The initial S24 tool passed 30/30 anonymous live staging checks. Those checks are **historical evidence for the original S24 tool**, not evidence that a newly edited preflight was rerun against live staging. A local independent review hardened the tool by requiring the exact staging service and Hosting site, verifying the expected upstream service prefixes, requiring the staging-only session secret and approved staging browser origins, and refusing to contact URLs when the described service identity is unexpected. Four additional isolated regression tests cover these cases.

The hardened tool remains **read-only** and requires another normal read-only live run by TEJA before it is called live-verified. Even then, a closed `/ready` and anonymous 401s do **not** establish signed-in release readiness or approval to promote traffic.
