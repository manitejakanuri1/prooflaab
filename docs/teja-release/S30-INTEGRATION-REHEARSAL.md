# S30 — Integration rehearsal

Date: 9 October 2026. Laptop: TEJA. Worktree: `prooflabai-claude-s30`.
Branch: `fix/teja-claude-s30-integration-2026-10-09`. Base commit: `851cf7ecca4ff92be2e1507cca9476a33c057728`.

**Nothing was committed, pushed, deployed, migrated or changed in the cloud. No secret was read. No account was created or reset. No source worktree was written to.**

## 1. Executive summary

| Question | Answer |
|---|---|
| Is the integration candidate built? | Yes. S23 + S25 + S27 + S29 + R2 are together in the S30 worktree, uncommitted. |
| Did the local checks pass? | Yes. 22 check groups run, 22 passed, 0 failed (398 individual tests). 5 groups skipped, listed in section 8. |
| Were the two collisions real? | Not as three-way conflicts. **S23 is already inside the base commit** (commit `13771d2`). So both files were "base (with S23) + S27". S27 applied cleanly. |
| Was product code changed beyond the reviewed sources? | No. Every product file is byte-for-byte the source version (line endings aside). S30 added two test files and two lines of CI. |
| Did the four dashboards change? | No menu, route, sidebar or `src/App.tsx` change. Two Student files changed (R2), inside existing screens. |
| Is Sidhu's work in? | **No.** S26 and S28 files are not on this laptop. |
| Is this ready for production? | **No.** Identity is 0/5, nothing is proven on staging, production has no gateway. This is a candidate for Teja Bash R4 review only. |

Status: **PASS for the local rehearsal.** Release blockers remain (sections 11 to 13).

## 2. Sources

All under `C:\Users\manit\Downloads\prooflabai-mvp\`. All inspected read-only.

| Source | Branch | HEAD (its base) | Working state found |
|---|---|---|---|
| S23 `prooflabai-claude-s23` | `fix/teja-claude-bff-s23-2026-10-09` | `bf10ad25a43b9959600727638de8b34f7f70f918` | 7 modified, 2 untracked |
| S25 `prooflabai-claude-s25` | `fix/teja-claude-s25-identity-prod-readiness-2026-10-09` | `851cf7ecca4ff92be2e1507cca9476a33c057728` | 5 untracked |
| S27 `prooflabai-claude-s27` | `fix/teja-claude-s27-staging-integration-2026-10-09` | `851cf7ecca4ff92be2e1507cca9476a33c057728` | 5 modified, 5 added (staged) |
| S29 `prooflabai-claude-s29` | `fix/teja-claude-s29-identity-five-role-2026-10-09` | `851cf7ecca4ff92be2e1507cca9476a33c057728` | 3 added (staged) |
| R2 `prooflabai-bash-r2` | `fix/teja-bash-r2-view-submission-2026-10-09` | `851cf7ecca4ff92be2e1507cca9476a33c057728` | 2 modified |
| S30 (target) | `fix/teja-claude-s30-integration-2026-10-09` | `851cf7ecca4ff92be2e1507cca9476a33c057728` | clean before work |

Every file list matched the assignment. No unexpected source change was found.

Base history: `bf10ad2` -> `13771d2` (S23 work, committed) -> `851cf7e` (S24 preflight).

## 3. Imported files (23 in the worktree: 7 modified, 16 new)

"Same as source" means identical to the source worktree file after ignoring Windows line endings. Checked for every row.

| # | File in S30 | From | Kind | What it does | Security note | Same as source |
|---|---|---|---|---|---|---|
| 1 | `web-bff/publicRoutes.ts` | S27 | new | Signed-out read of one published portfolio | Fixed query, field allowlist, same 404 for every failure. Uses the gateway's server credential. | Yes |
| 2 | `web-bff/publicRoutes.test.ts` | S27 | new | 9 tests for the route | - | Yes |
| 3 | `web-bff/main.ts` | S27 | modified | Calls the public route (5 lines) | See collision A | Yes |
| 4 | `.github/workflows/web-bff-ci.yml` | S27 + S30 | modified | Adds the two new test files to CI | See collision B | S27 line: yes. Plus 2 S30 lines |
| 5 | `src/lib/publicPortfolio.ts` | S27 | new | Browser reader for the route | Sends no cookie. Slug is encoded. | Yes |
| 6 | `src/lib/publicPortfolio.test.ts` | S27 | new | 4 tests | - | Yes |
| 7 | `src/hooks/usePortfolio.tsx` | S27 | modified | Signed out: reads the public route. Signed in: as before, public route as fallback | No student id reaches a stranger's browser | Yes |
| 8 | `src/pages/Portfolio.tsx` | S27 | modified | Uses the work list that came with the answer (2 lines) | - | Yes |
| 9 | `src/components/portfolio/ProvenWork.tsx` | S27 | modified | Optional `rows` input. Without it, unchanged | - | Yes |
| 10 | `docs/teja-release/S27-STAGING-INTEGRATION-AND-ARCHITECTURE-FREEZE.md` | S27 | new | Report | - | Yes |
| 11 | `src/components/dashboard/student/StudentAssignedTasksPage.tsx` | R2 | modified | "View Submission" button now opens the Build-log entry | Link only. Reads nothing | Yes |
| 12 | `src/components/dashboard/student/BuildLogEntries.tsx` | R2 | modified | Scrolls to and opens the card named by `?task=` | Matches only against the student's own loaded entries | Yes |
| 13 | `scripts/dev-tools/identity_fixture_preflight.py` | S25 | new | Read-only Identity fixture check | Only `GET` config, `GET` tenants, `POST accounts:lookup` (a read). Token held in memory | Yes |
| 14 | `scripts/dev-tools/test_identity_fixture_preflight.py` | S25 | new | 25 tests | - | Yes |
| 15 | `scripts/dev-tools/production_bff_preflight.py` | S25 | new | Read-only production gateway check | `gcloud run services list` and `get-iam-policy` only | Yes |
| 16 | `scripts/dev-tools/test_production_bff_preflight.py` | S25 | new | 27 tests | - | Yes |
| 17 | `docs/teja-release/S25-IDENTITY-AND-PRODUCTION-READINESS.md` | S25 | new | Report | - | Yes |
| 18 | `scripts/dev-tools/teja_s29_role_readiness.py` | S29 | new | Read-only five-role check | `accounts:lookup` only | Yes |
| 19 | `scripts/dev-tools/test_teja_s29_role_readiness.py` | S29 | new | 32 tests | - | Yes |
| 20 | `docs/teja-release/S29-IDENTITY-AND-FIVE-ROLE-READINESS.md` | S29 | new | Report | - | Yes |
| 21 | `web-bff/mainRouting.test.ts` | **S30** | new | 6 tests of the whole gateway as wired | Test only. **Not yet reviewed** | - |
| 22 | `src/lib/viewSubmissionLink.test.ts` | **S30** | new | 4 tests of the View Submission link | Test only. **Not yet reviewed** | - |
| 23 | `docs/teja-release/S30-INTEGRATION-REHEARSAL.md` | **S30** | new | This report | - | - |

How they were moved: S27 and R2 as patches (`git apply`, checked first with `--check`). S25 and S29 as new-file copies, after checking no file of that name existed.

The S25 and S29 scripts were **not run** (they read the cloud). Only their unit tests were run.

## 4. Not transferred

| File | Source | Why |
|---|---|---|
| `.github/workflows/web-bff-ci.yml` | S23 | Already in base. S23 copy is identical to `13771d2` and `851cf7e`. |
| `docs/STAGING-TEST-FIXTURES.md` | S23 | Same. |
| `scripts/dev-tools/staging_browser_e2e.mjs` | S23 | Same. |
| `scripts/release_guard.py` | S23 | Same. |
| `scripts/test_release_guard.py` | S23 | Same. |
| `web-bff/Dockerfile` | S23 | Same. |
| `web-bff/main.ts` | S23 | Same. |
| `web-bff/readiness.ts` | S23 | Same. |
| `web-bff/readiness.test.ts` | S23 | Same. |

Nothing was excluded for being unsafe. Copying S23 over S30 would have **removed** S27's lines from the two shared files, so it was not done.

## 5. The two collisions

Both files were changed by S23 and by S27. S23's change is already the base, so the real question was: does S27 sit correctly on top of it?

### A. `web-bff/main.ts`

Kept: every base line (including all S23 lines) + S27's two hunks (1 import, 4 lines in the handler). Nothing else.

Route order in the handler, top to bottom:

```
1. /health, /healthz      liveness, GET only          (S23)
2. cross-site write guard                             (base)
3. sign-in / session routes                           (base)
4. /api/public/**         published portfolio only    (S27)  <- new
5. /api/db, functions, files ... need a login         (base)
6. /ready                 closed unless truly ready   (S23)
7. anything else          404                         (base)
```

| Must hold | Proof |
|---|---|
| Public portfolio only through the approved path | `handlePublicRoute` answers only `/api/public/portfolio/<slug>`; every other `/api/public/...` is 404. Tests: `publicRoutes.test.ts`, `mainRouting.test.ts`. |
| `/api/db/**` not opened to signed-out callers | Through the real handler: 401 with a database configured, 503 with none, never 200. `mainRouting.test.ts`. Also `publicRoutes.test.ts` "reproduction". |
| Path tricks cannot cross over | `/api/public/../db/...` is folded to `/api/db/...` by the URL parser and gets the login check. `..%2F` never matches the slug rule and is 404. Tested both ways. |
| Private, unknown, suspended, broken all look the same | One 404 body `{"error":"not found"}`. Tested. |
| Only named fields leave | Exact field list asserted; id, email, phone, roll number, college, code checked absent. |
| Browser cookie, token, query never reach the database | Tested. A cookie on the public route changes nothing and no cookie is set. |
| Writes refused | POST, PUT, PATCH, DELETE answer 403 or 405. Tested through the handler. |
| `/health` and `/ready` stay different | `/health` 200, `/ready` 503 with no settings. Tested in both `readiness.test.ts` and `mainRouting.test.ts`. |
| The release switch alone does not open `/ready` | `readiness.test.ts` (17 tests, unchanged) and the CI container step. |
| Sessions, suspension, revocation untouched | `authRoutes.ts`, `session.ts`, `sessionStore.ts`, `proxyRoutes.ts`, `requestGuard.ts`, `readiness.ts` have no change. Their tests still pass (78 in the security gate). |

### B. `.github/workflows/web-bff-ci.yml`

| Hunk | From | Kept |
|---|---|---|
| Readiness test step, `/health` container probe, "release switch alone" step | S23 (in base) | Yes, untouched |
| `web-bff/publicRoutes.test.ts` added to "BFF security tests" (runs with no permissions) | S27 | Yes |
| `web-bff/mainRouting.test.ts` added to the readiness step; step renamed; comment "this file" -> "these files" | S30 | Yes |

Checks: the file parses as YAML; 11 steps, none duplicated; triggers and `permissions: contents: read` unchanged; both test commands were run on this laptop exactly as written and passed (78 and 23). The routing test goes in the readiness step because it loads `main.ts`, which reads settings. It gets the same setting names as the container and no network.

Not run here: the three Docker steps (Docker is not installed). CI runs them.

## 6. S23 against its older base

| Check | Result |
|---|---|
| S23 base | `bf10ad2`, two commits behind `851cf7e` |
| S23's nine working files against commit `13771d2` | All nine identical |
| S23's nine working files against `851cf7e` | All nine identical |
| What `851cf7e` added after `13771d2` | Three S24 files only. None is an S23 file. |

So S23 is fully contained in the S30 base. No S23 file was copied. There is no compatibility risk from the older base.

## 7. S23 extra scope: `release_guard.py` and its test

Why they changed: S23 moved the gateway's liveness address from `/healthz` to `/health`, because Google's edge answers `/healthz` itself on a `run.app` address (a known quirk, already recorded in the project notes). The release guard probes that address before publishing production. Left on `/healthz` it would have blocked every release, or worse, been "fixed" loosely later.

| File | Change | Needed? |
|---|---|---|
| `scripts/release_guard.py` | Probe `/health` not `/healthz` (1 code line, 4 wording lines) | Yes. It follows directly from the gateway change. |
| `scripts/test_release_guard.py` | 3 new tests: asks `/health` only, trailing slash, refuses on down / wrong / non-JSON answers | Yes. Tests the line above. |

The guard is not loosened: every refusal rule is unchanged. Both files are already committed in the base (`13771d2`). Tests: 17/17 pass.

**Disposition: RETAINED (already in base, necessary, compatible).**

## 8. Tests run

All run in the S30 worktree. `npm ci` was run once (locked versions, no upgrade).

| # | Command | Result |
|---|---|---|
| 1 | `git diff --check` (also with new files, through a throw-away index) | PASS |
| 2 | `python scripts/secret_scan.py` (1,118 files, new files included) | PASS, 0 findings |
| 3 | `python scripts/legacy_guard.py` (new files included) | PASS, 0 active occurrences |
| 4 | `python scripts/migrations.py check` | PASS, 104 migrations, 0 problems. No migration added. |
| 5 | `python scripts/test_atomic_migration_guard.py` | PASS 6/6 |
| 6 | `python scripts/test_release_guard.py` | PASS 17/17 |
| 7 | `python scripts/test_google_api_key.py` | PASS 3/3 |
| 8 | `python scripts/test_runner_configuration.py` | PASS 2/2 |
| 9 | `python scripts/dev-tools/test_staging_bff_preflight.py` (S24) | PASS 31/31 |
| 10 | `python scripts/dev-tools/test_identity_fixture_preflight.py` (S25) | PASS 25/25 |
| 11 | `python scripts/dev-tools/test_production_bff_preflight.py` (S25) | PASS 27/27 |
| 12 | `python scripts/dev-tools/test_teja_s29_role_readiness.py` (S29) | PASS 32/32 |
| 13 | `node --experimental-strip-types --test src/lib/*.test.ts` | PASS 139/139 (131 base + 4 portfolio + 4 View Submission) |
| 14 | `npm run typecheck` | PASS |
| 15 | `deno test --no-lock --allow-env --allow-read --allow-import web-bff/` | PASS 101/101 (86 base + 9 public route + 6 routing) |
| 16 | CI security step: `deno test --no-lock` on the 8 listed files, no permissions | PASS 78/78 |
| 17 | CI readiness step: `deno test --no-lock --allow-env=<container list> web-bff/readiness.test.ts web-bff/mainRouting.test.ts` | PASS 23/23 |
| 18 | `deno check --no-lock web-bff/main.ts` | PASS |
| 19 | `deno test --no-lock --allow-env --allow-net auth-bridge/` (dummy CI secret) | PASS 15/15 |
| 20 | `npm run build` (production settings) | PASS |
| 21 | `python scripts/browser_security_gate.py dist` | PASS |
| 22 | Workflow YAML parse (`yaml.safe_load`) | PASS |

Passed 22, failed 0.

One failure happened on the way and was fixed: the first draft of the new routing test expected 401 from `/api/db` with no settings. The gateway answers 503 there ("database proxy unavailable"), which is also closed. That was a wrong expectation in the new test, not a product defect. The test now checks both states: 503 with no settings, 401 with a database configured.

| Skipped | Why |
|---|---|
| Docker build and the two container steps of `web-bff-ci.yml` | Docker is not installed on this laptop. CI runs them. |
| Browser harness runs (`four_dashboards_mock_browser.mjs` and the others) | Need a Playwright browser and a local server. Not run. Sidhu's S26 covers this. |
| Live signed-in browser tests | Not allowed in S30, and there are no test logins (0/5). |
| Running the S24 / S25 / S29 preflight scripts themselves | They read the cloud. Only their unit tests were run. |
| Server-function, files-service, accounts and transcriber tests; `eslint` | That code is not touched by this integration. Not run, so not claimed. |

## 9. Regression coverage

| Behaviour | Covered by | Kind |
|---|---|---|
| Completed task -> View Submission -> Build-log card of that task | `src/lib/viewSubmissionLink.test.ts` (new, 4 tests) | Source contract: the button's link, the dashboard's `tab` / `view` reading, the card id and the lookup must agree |
| The `?task=` value is never used to query data | Same file | Source contract |
| Signed-out portfolio read, allowlist, uniform 404, unsafe slugs, GET only | `web-bff/publicRoutes.test.ts` (9) | Unit, mocked database |
| Browser reader: no cookie, encoded slug, HTML not mistaken for data | `src/lib/publicPortfolio.test.ts` (4) | Unit |
| Route order in the real handler; `/api/db` stays closed; path tricks; `/health` vs `/ready` | `web-bff/mainRouting.test.ts` (new, 6) | Whole handler, no network |
| Fail-closed readiness | `web-bff/readiness.test.ts` (17, unchanged) | Unit + handler |
| Sessions, suspension, revocation, cross-site guard | Existing gateway tests (unchanged, passing) | Unit |

Limits, said plainly:

- The View Submission test reads source text. It does not click a button. No browser test of it was run.
- "Student A cannot see Student B's submission" rests on the database's own rules, which this work does not change. The Build-log still loads only the signed-in student's rows; a foreign task id in the link finds no card and does nothing. Not proven against a live database here.
- All portfolio tests use a stand-in database. They prove the code's rules, not a real staging answer.

## 10. Security and privacy findings

| # | Finding | Level | Action |
|---|---|---|---|
| 1 | The public route reads with the gateway's server credential, which passes over row rules. Safety rests on the fixed query and the field allowlist in `publicRoutes.ts`. | Note | Keep the allowlist tests mandatory in CI (they are). Any new field needs review. |
| 2 | No rate limit on the public route (the gateway has none anywhere). Each call is two small reads. | Low | Owner decision (carried from S27). |
| 3 | A portfolio is public only when `is_public` AND profile visibility "Anyone with the link" AND account active. Stricter than the signed-in rule. | Note | Owner decision (carried from S27). |
| 4 | The resume scorecard is not shown to signed-out visitors, but the student toggle text says it is included. | Low | Owner decision: add later or change the text. |
| 5 | Nothing writes `student_portfolios.slug`. In production "Share Portfolio" will have no link until slugs exist. Needs a migration; not done. | Functional gap | Owner decision. |
| 6 | Build-log cards use the id `build-log-<task id>`. Two submissions of one task give two cards with one id; the link opens the first (newest). | Low | Accept, or key by submission later. |
| 7 | Staging and production **share one Google Identity**. A test login made for staging is a real login in production's Identity too. | High (process) | Create fixtures only with owner approval, with strong passwords, and record each one. Not done in S30. |
| 8 | The S25 / S29 scripts take the signed-in gcloud user's short-lived token in memory. It is not printed or stored. | Note | Run only by the owner. |
| 9 | No secret, token, password or personal data is in the changed files. | Pass | Secret scan 0 findings over 1,118 files. |
| 10 | **Public by default.** Opening the student Portfolio screen creates the portfolio row with `is_public: true` (`usePortfolio.tsx`, existing code, not changed here), and `profile_visibility` defaults to `public` in the database. So all three conditions of finding 3 can be true without the student choosing anything. Today no slug exists outside test data, so nothing is reachable. The day slugs are created, those portfolios open to signed-out visitors. | **Medium** | Owner decision **before** any slug writer ships: make sharing an explicit choice (create the row private), or confirm public-by-default is intended. |

No general anonymous database access was added. `proxyRoutes.ts` is unchanged.

## 11. Sidhu dependencies (not integrated)

Status: **NOT INTEGRATED.** No S26 or S28 file was used, guessed or rebuilt.

Needed from Sidhu before staging promotion:

1. S26 and S28 as a branch on `manitejakanuri1/prooflaab` based on `851cf7e`, or a zip with its base commit and file list.
2. The S28 final result: four-dashboard source, route, endpoint-contract and permission findings.
3. The one failing S26 anonymous staging check (23 of 24): which check, and is it the public portfolio (which this candidate addresses, once deployed)?

Files to compare first, because S30 changed them:

| File | Why it may collide |
|---|---|
| `web-bff/main.ts`, `.github/workflows/web-bff-ci.yml` | Changed here |
| `src/hooks/usePortfolio.tsx`, `src/pages/Portfolio.tsx`, `src/components/portfolio/ProvenWork.tsx` | Changed here |
| `src/components/dashboard/student/StudentAssignedTasksPage.tsx`, `BuildLogEntries.tsx` | Changed here; S28 audits these screens |
| `scripts/dev-tools/staging_browser_e2e.mjs`, `scripts/dev-tools/harness/` | S26 hardens these; base already has S23's edit |

Sidhu should re-run on this candidate: the 42 harness tests, the four-dashboard route and tab reachability check, and "View Submission" in a real browser.

## 12. Five-role Identity blocker

**Identity ready: 0/5.** Not re-verified in S30; the S29 result stands.

| Fact (from S29) | State |
|---|---|
| Five staging database fixtures meet the checked sign-in data needs | Yes |
| Identity logins present | 1 of 5 (Admin). Four are missing. |
| Admin test password supplied | No |
| Roles that can be signed in for a test today | 0 of 5 |

Every signed-in journey is therefore unproven. Mock and unit tests in this report are **not** signed-in browser tests. S30 created and reset no account. See finding 7: staging and production share Google Identity.

## 13. Production blockers

As reported by S24, S25 and S27. Not re-checked in S30 (no cloud reads were made).

1. Production has no gateway service, no `/api/**` Hosting rule and no signing configuration (S25: 6 of 19 checks).
2. Production migrations 95 to 102 are unverified. Do not apply on a guess.
3. Staging runs an older site and an older gateway than the base commit. The base's sign-in changes are untried on staging.
4. Four infrastructure drift items await owner approval (S24).
5. Identity 0/5 (section 12).
6. Sidhu's S26 / S28 not received (section 11).
7. No portfolio slug writer (finding 5), and the public-by-default question must be answered first (finding 10).
8. Docker steps of the gateway CI have not run on this candidate.
9. Nothing here is committed or on GitHub.

## 14. Risks and rollback

| Risk | Effect | Guard |
|---|---|---|
| New site deployed before the new gateway | Shared portfolio shows "Portfolio Not Found" (same as today) | Deploy gateway first (S27 section 6) |
| Staging database does not answer the gateway's two reads | Route answers 404. Safe. | Canary check before traffic |
| S26 / S28 touch the same files | Merge conflict or lost lines | Compare the files in section 11 first |
| S30's two new tests are unreviewed | A weak test gives false comfort | R4 review of `mainRouting.test.ts` and `viewSubmissionLink.test.ts` |
| Source-text test breaks on a harmless rewrite | False alarm in CI | Replace with a browser test when one exists |

Rollback of this rehearsal: nothing is committed, so `git restore .` plus deleting the 16 new files returns S30 to `851cf7e`. Ask before doing that; it deletes files. No database, cloud or account rollback exists because none was changed. Staging and code rollback for a later deploy are in the S27 report, section 7.

## 15. Next steps, each needs a yes

1. Teja Bash R4: independent review of this candidate and the zip.
2. Receive and compare Sidhu's S26 / S28 (section 11).
3. Owner decisions: public-by-default portfolios (finding 10), scorecard for strangers, visibility rule, slug writer, rate limit.
4. Commit on this branch and push to `prooflaab` only (never `origin`); let both CI runs go green, including Docker.
5. Owner creates the four missing staging logins and supplies the Admin test password (shared Identity: handle as real accounts).
6. Staging: gateway canary at 0% traffic, check, move traffic, then the site (S27 section 6).
7. Five signed-in journeys on staging, by Sidhu.
8. Production: only after 1 to 7, the S25 preflight and verified migrations.

## Not touched

Production. Staging. Databases. Identity accounts. IAM. Secrets. Cloud Run, Hosting, DNS. The S23, S25, S27, S29, R2 and Sidhu worktrees. The git index and history of S30 (no commit, nothing staged).
