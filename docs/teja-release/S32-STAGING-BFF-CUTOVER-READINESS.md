# S32 — Staging gateway (BFF) cutover readiness

Date: 9 October 2026. Laptop: TEJA. Worktree: `prooflabai-claude-s32`.
Branch: `fix/teja-claude-s32-staging-bff-cutover-2026-10-09`. Base commit: `851cf7ecca4ff92be2e1507cca9476a33c057728`.

**Nothing was committed, pushed or deployed. No cloud read or change, no database write, no Identity action. S30, S31 and every other worktree were not changed.**

## 1. The answer first

| Question | Answer |
|---|---|
| Is the website -> gateway -> backend routing correct in the code? | Yes. Every `/api` address the website calls has a gateway route, and the build holds no backend address. Now pinned by tests. |
| Was a local staging defect found? | Yes, one. The staging settings file told people to run a command that can no longer sign in, and described six addresses the site no longer reads. Fixed (comment only). |
| Were tests missing? | Yes. Nothing tested the Hosting rewrite order, the website/gateway route match, or a rollback. Added. |
| Did local checks pass? | 24 check groups run, 24 passed, 0 failed. 5 skipped (section 7). |
| Is staging ready for signed-in testing? | **No.** Staging runs an older gateway and site, and there are no test logins (Identity 0/5). Section 9. |
| Is production ready? | **No.** Production has no gateway. Section 10. |

All cloud facts in this report come from the S24 and S27 reports. They were **not re-checked** in S32.

## 2. How a request travels

```
browser --> Firebase Hosting --+--> /api/**  --> gateway (Cloud Run) --> auth-bridge, database,
 (same origin, cookie          |                  checks origin,          functions, files,
  __session only)              |                  session, account        accounts, transcriber
                               +--> anything else --> index.html (the app)
```

Hosting uses the **first** matching rewrite. `/api/**` must come before the catch-all, or every API call gets the app page.

## 3. Route audit

Source of truth is now `web-bff/routes.contract.json` (15 entries), tested from both sides.

| Website calls | Method | Without a login | Gateway sends it to |
|---|---|---|---|
| `/api/auth/login` | POST | answers | Identity |
| `/api/auth/session` | GET | 200, `session: null` | session store |
| `/api/auth/logout` | POST | answers | session store |
| `/api/auth/signup` | POST | 403 (accounts are managed) | nothing |
| `/api/auth/update` | POST | answers (refuses inside) | Identity |
| `/api/auth/verify-email`, `/api/auth/resend-verification` | POST | answers | Identity |
| `/api/auth/password-reset/request`, `/verify`, `/complete` | POST | answers | Identity |
| `/api/db/**` | any | **401** | `POSTGREST_URL` |
| `/api/functions/<name>` | POST | **401** | `FUNCTIONS_URL` |
| `/api/files/<bucket>/<path>` | GET, PUT, DELETE | **401** | `FILES_URL` |
| `/api/accounts/remove` | POST | **401** | `ACCOUNTS_URL` |
| `/api/transcriber/transcribe` | POST | **401** | `TRANSCRIBER_URL` |
| `/api/public/portfolio/<slug>` | GET | **not routed at this base** (plain 404) | - |

| Check | Result |
|---|---|
| Every `/api` address in `src/` is in the contract | Yes (test) |
| The website reads a backend address at build time | No. `src/` reads only `VITE_PUBLIC_BUCKET` and `VITE_ASYNC_TRANSCRIPTION` (test) |
| A Cloud Run address inside the production or staging build | None found in either build |
| Paths outside the contract (`/api/unknown`, `/api/accounts/create`, `/service-token`, ...) | Plain 404, nothing sent to a backend (test) |

**Public portfolio:** the route does not exist at the frozen base. It is S27's work and lives in S30. It was not copied here. Until S30 is merged, a signed-out portfolio link shows "Portfolio Not Found".

## 4. Sessions, cookies, origin checks, readiness

| Area | What the code does | Proof |
|---|---|---|
| Cookie | Name `__session`; `Path=/; HttpOnly; Secure; SameSite=Strict`. | `session.test.ts` (existing) |
| Cookie name and Hosting | Hosting passes **only** a cookie named `__session` to Cloud Run. The gateway uses that name. A rename would silently break sign-in. | Read in `session.ts` |
| Forged cookie | Refused; no data backend is called. | New test |
| Anonymous session | `200 {"session": null}`; no backend is called. | New test |
| Writes from another site | 403 on every write route for: another origin, a lookalike origin, `http://` instead of `https://`, `Origin: null`, and `Sec-Fetch-Site` cross-site or same-site. | New test (9 write routes x 6 cases) |
| The staging site itself | Allowed through (`https://prooflab-staging.web.app` in `BROWSER_ORIGINS`), although the request arrives on the Cloud Run address. | New test |
| `/health` | 200 while the process is up. Says nothing about readiness. | Existing + new test |
| `/ready` | 503 unless the release switch is on **and** settings are valid **and** every backend answered just now. With staging settings and no switch: 503, and no backend is probed. | `readiness.test.ts` (17, existing) + new test |
| Suspension, revocation | Unchanged. | `accountRecheck.test.ts`, `sessionStore.test.ts` (existing, passing) |

Existing design, not changed, worth knowing: a write with **no** `Origin` and **no** `Sec-Fetch-Site` header is let through (for tools and tests). Browsers always send `Origin` on such writes, and the cookie is `SameSite=Strict`, so a browser cannot be used this way.

## 5. What was changed

11 files in the worktree: 4 modified, 7 new. Plus this report (12 in all).

| File | Kind | Change |
|---|---|---|
| `.env.staging` | modified, **comments only** | The fix for the confirmed defect (below). No value changed. |
| `scripts/hosting_rewrites.py` | new | The rewrite list, moved out of the deploy script so it can be tested. Same output. |
| `scripts/deploy-hosting.py` | modified | Uses that list (13 lines became 2, 1 import). |
| `scripts/test_hosting_rewrites.py` | new | 4 tests. |
| `web-bff/routes.contract.json` | new | The 15 routes. Data only. |
| `web-bff/routeContract.test.ts` | new | 9 tests through the whole gateway, no network. |
| `src/lib/apiRouteContract.test.ts` | new | 2 tests of the website side. |
| `scripts/dev-tools/staging_rollback_plan.py` | new | **Prints** the staging rollback commands. Runs nothing. Refuses non-staging names. |
| `scripts/dev-tools/test_staging_rollback_plan.py` | new | 5 tests. |
| `.github/workflows/web-bff-ci.yml` | modified | Route contract test added to the readiness step. |
| `.github/workflows/deploy.yml` | modified | One test step added (rewrite tests) in the test job. The deploy job is untouched. |

No gateway source file changed. No dashboard, route or screen changed.

### The confirmed defect: stale local staging setup

| | Before | After |
|---|---|---|
| `.env.staging` said | "Run with `npm run dev -- --mode staging`" | That command can no longer sign in, and why; the working command (the gateway harness) is given. |
| `.env.staging` said | "Every URL below points at a staging service" as if the site used them | The six `VITE_*_URL` lines are no longer read by the site and are not in the build. Kept as a record. |
| Risk | Someone runs the old command, sees the app page for every API call, and concludes staging sign-in is broken. | - |

The six unused lines were **not deleted** (deleting needs your yes). Several script headers under `scripts/dev-tools/` still mention `npx vite --mode staging --port 5173`; those were left alone (Sidhu's S26 harness work touches them).

### The one change to a production file

`scripts/deploy-hosting.py` is the production publish script. The change is a move, not a new behaviour: the test asserts the list is exactly what it was. It compiles and the release guard still runs first (tested). **It was not run** (it needs gcloud and publishes). Review this file with care.

## 6. Deployment configuration found missing or weak

| # | Finding | Where | Level | Action |
|---|---|---|---|---|
| 1 | No test covered the Hosting rewrite order. | repo | Fixed | Tests added, in CI. |
| 2 | No rollback tool for staging; the site rollback was "one API call" written in a report. | repo | Fixed | `staging_rollback_plan.py` prints the commands. |
| 3 | Stale local staging instructions. | `.env.staging` | Fixed | Section 5. |
| 4 | The release guard knows a "staging build" only by one string: the staging public bucket name. Nothing else in a staging build says staging. | `release_guard.py` | Low | Keep `VITE_PUBLIC_BUCKET` a `prooflab-staging-*` name (now written in the file). Not changed. |
| 5 | The guard does **not** stop a production-mode build being published to the staging site. Effect: staging would show images from the production public bucket. | `release_guard.py` | Low | Recommend one more staging rule. Not added: it changes guard behaviour and needs your yes. |
| 6 | Nothing stamps the deployed commit on the site or the gateway. | deploy | Medium | Write down revision and Hosting version at each deploy (section 8). |
| 7 | Hosting cuts a rewritten request at 60 seconds, and the gateway is set to 60 s. The direct transcribe route can run long. | Hosting / gateway | Low | Queued transcription is on, so the long call is not the normal path. Watch for 504 on staging. |
| 8 | The gateway image copies its test files (`COPY . .`, no ignore file). | `web-bff/Dockerfile` | Note | Harmless. Not changed. |
| 9 | `BROWSER_ORIGINS` is read once at start. | gateway | Note | Changing it means a new revision. |
| 10 | No rate limit anywhere on the gateway. | gateway | Known | Owner decision (also in S27). |

## 7. Tests

| # | Check | Result |
|---|---|---|
| 1 | `git diff --check` (new files included) | PASS |
| 2 | `python scripts/secret_scan.py` (new files included) | PASS, 0 findings |
| 3 | `python scripts/legacy_guard.py` | PASS, 0 active occurrences |
| 4 | `python scripts/migrations.py check` | PASS, 104 migrations, 0 problems. None added. |
| 5 | `python scripts/test_release_guard.py` | PASS 17/17 |
| 6 | `python scripts/test_hosting_rewrites.py` (new) | PASS 4/4 |
| 7 | `python scripts/test_atomic_migration_guard.py` | PASS 6/6 |
| 8 | `python scripts/test_google_api_key.py` | PASS 3/3 |
| 9 | `python scripts/test_runner_configuration.py` | PASS 2/2 |
| 10 | `python scripts/dev-tools/test_staging_bff_preflight.py` | PASS 31/31 |
| 11 | `python scripts/dev-tools/test_staging_rollback_plan.py` (new) | PASS 5/5 |
| 12 | `node --experimental-strip-types --test src/lib/*.test.ts` | PASS 133/133 (131 base + 2 new) |
| 13 | `npm run typecheck` | PASS |
| 14 | `npm run build` (production settings) | PASS |
| 15 | `npx vite build --mode staging --outDir dist-staging` | PASS |
| 16 | `python scripts/browser_security_gate.py` on both builds | PASS, PASS |
| 17 | `deno test --no-lock --allow-env --allow-read --allow-import web-bff/` | PASS 95/95 (86 base + 9 new) |
| 18 | CI security step (7 listed files, no permissions) | PASS 69/69 |
| 19 | CI readiness + route contract step (container setting names only, no network) | PASS 26/26 |
| 20 | `deno check --no-lock web-bff/main.ts` | PASS |
| 21 | `deno test ... auth-bridge/` (dummy CI secret) | PASS 15/15 |
| 22 | Both workflow files parse as YAML | PASS |
| 23 | Release guard dry runs on the real builds, no network (table below) | PASS, 4 of 4 as expected |
| 24 | `python -m py_compile` on the deploy script and the two new scripts | PASS |

Release guard dry runs (`python scripts/release_guard.py <build>`; it only reads the build and settings):

| Site | Gateway named | Build | Expected | Got |
|---|---|---|---|---|
| staging | staging gateway | staging | allowed | allowed |
| staging | production gateway | staging | refused | refused: "a staging site must use a staging gateway" |
| production | production gateway | **staging** | refused | refused: "this is a staging build" |
| production | production gateway | production, no approval | refused | refused |

| Skipped | Why |
|---|---|
| Docker build and container steps of the gateway CI | Docker is not installed. CI runs them. |
| Running `deploy-hosting.py` | It publishes. Not allowed. |
| Running `staging_bff_preflight.py` and any live staging check | It reads the cloud. Not done in S32. |
| Signed-in browser tests | No test logins (Identity 0/5). |
| Server-function, files-service, accounts, transcriber tests; `eslint` | Code not touched. Not run, so not claimed. |

Limits, said plainly: the new gateway tests use a stand-in for every outbound call. They prove the gateway's own routing and refusals. They do not prove that Firebase Hosting, Cloud Run or the staging backends behave this way.

## 8. Rollback (staging)

Print the plan (it runs nothing):

```
python scripts/dev-tools/staging_rollback_plan.py --stable-revision <revision> --site-version <version id>
```

Order: gateway traffic first, then the site. No database step.

| Value | Last known good (from the S27 report, **not re-checked**) |
|---|---|
| Gateway revision | `prooflab-staging-web-bff-00004-9nn` |
| Hosting version | `939a668ef6990b38` |

Before any staging deploy, write down the two current values. They are the rollback target.

Rollback of S32 itself: nothing is committed. Undo the 4 edits and delete the 7 new files. Ask first; it deletes files.

## 9. Staging blockers

1. Staging serves an older gateway revision (no `/health`, no account re-check) and an older site than the base commit.
2. No test logins: Identity 0/5. Four logins are missing and the Admin test password is not supplied. Staging and production **share one Google Identity**.
3. The gateway release switch (`BFF_RELEASE_READY`) is off, so `/ready` is 503. Correct for now; someone must decide when to turn it on.
4. The public portfolio route is not in this base (it is in S30).
5. Docker steps of the gateway CI have not run on this change.
6. Sidhu's S26 / S28 work is not merged with S30, S31 or S32.
7. S30, S31 and S32 all change `.github/workflows/web-bff-ci.yml` near the same lines (S30 and S32 both add a file to the readiness step). Easy to merge by hand; it will conflict in Git.

## 10. Production blockers

1. No production gateway service (`prooflab-web-bff`) exists.
2. No `/api/**` rule on the production site. The release guard refuses a publish until `PRODUCTION_BFF_SERVICE`, `PRODUCTION_BFF_HEALTH_URL` and `PRODUCTION_RELEASE_APPROVED_SHA` are set as repository variables.
3. No production session key secret or gateway service account.
4. Production `BROWSER_ORIGINS` must be the production site addresses only. No staging site, no localhost.
5. Production migrations 95 to 102 are unverified.
6. Four infrastructure drift items await your approval (S24).
7. Nothing here is committed or on GitHub.
8. Everything in section 9 comes first.

## 11. Next steps, each needs a yes

1. Teja Bash review of this patch, `deploy-hosting.py` first.
2. Decide finding 5 (stop a production build reaching the staging site) and whether to delete the six unused lines in `.env.staging`.
3. Combine S30 + S31 + S32 in one worktree and re-run all checks.
4. Commit and push to `prooflaab` only; let CI run the Docker steps.
5. Staging: record current revision and Hosting version, gateway canary at 0%, preflight, move traffic, then the site.
6. Create the missing staging logins (owner), then Sidhu's signed-in runs.
