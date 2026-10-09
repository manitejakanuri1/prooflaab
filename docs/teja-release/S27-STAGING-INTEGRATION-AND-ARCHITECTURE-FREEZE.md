# S27 — Staging integration and architecture freeze

Date: 9 October 2026. Base commit: `851cf7ecca4ff92be2e1507cca9476a33c057728`.
Worktree: `prooflabai-claude-s27`, branch `fix/teja-claude-s27-staging-integration-2026-10-09`.

**Nothing was pushed, deployed, migrated or changed in the cloud.** All cloud checks were read-only.

## 1. The answer first

| Question | Answer |
|---|---|
| Is the public portfolio fixed? | Yes in code, with tests. Not on staging yet: it needs the two staging deploys in section 6. |
| Was it a new bug? | No. A signed-out visitor could never open a portfolio. The database has allowed signed-in readers only since the table was made. |
| Did the four dashboards change? | No. No dashboard, menu, tab or route file was touched. |
| Is S26 (SIDHU) integrated? | No. Its files are not on this laptop and not on GitHub. |
| Is staging the same as GitHub? | No. The staging site and the staging gateway are both older than the base commit. |
| Can we launch? | No. The four signed-in journeys are still BLOCKED (no real test logins). |

## 2. The public portfolio defect

### 2.1 Root cause (three layers, all verified in the code)

1. **The page reads the general database route.** `usePortfolio(slug)` calls `GET /api/db/student_portfolios`. That route needs a login, so a visitor gets `401 not authenticated`. This is correct for that route and it stays that way.
2. **The database never had a signed-out read.** `student_portfolios` has one read rule, for signed-in users only (migration stage 8). `portfolio_work()` is closed to signed-out callers (migration 63). The scorecard view was closed to them on purpose (migration stage 48, which says a public page "needs its own design").
3. **Even signed in, strangers get nothing.** The page joins `student_profiles`, which only the owner, their college and admins can read. So a company opening a shared link also saw "Portfolio Not Found".

The student screen meanwhile says "Anyone with the link can see it". The promise and the plumbing did not match.

Note on the test address: `fake-student-1` was written for a signed-in journey (`staging_browser_e2e.mjs`, the `established` list). SIDHU ran it signed out, which is the case that never worked.

### 2.2 The fix

One new narrow route in the gateway. It is not a proxy.

```
visitor --> GET /api/public/portfolio/<slug> --> gateway --> database (2 fixed questions)
                                                  |
                                                  +--> copies named fields only --> visitor
```

| Rule | How it is enforced |
|---|---|
| General `/api/db/**` stays closed to signed-out callers | Untouched. A test proves it still answers 401 and sends nothing to the database. |
| Only published portfolios | The database query requires all three: `is_public = true`, `profile_visibility = 'public'` ("Anyone with the link"), account `status = 'active'`. |
| Field allowlist | Answer holds only: `slug, bio, skills, achievements, full_name, profile_photo_url, total_xp, work[]`. Each work item: `task_id, title, category, kind, language, score, passed_count, total_count, passed_at, explanation_score, set_by`. |
| Never exposed | Student id, login identity, email, phone, roll number, college, recordings, transcripts, code, answers, resume scorecard. |
| No existence leak | Private, unknown, suspended, bad slug, database error and credential error all answer the same `404 {"error":"not found"}`. |
| Nothing from the browser reaches the database | Only the slug, and only if it matches `[A-Za-z0-9][A-Za-z0-9_-]{0,79}`. Browser cookie, token, key and query string are ignored. |
| Read only | GET only. Other methods answer 405. |

The page change is small: signed out, it reads the new route. Signed in, it reads as before and falls back to the new route when the database shows nothing. The work list arrives with the answer, so no student id is needed in the browser.

### 2.3 Files

| File | Change |
|---|---|
| `web-bff/publicRoutes.ts` | New. The public route. |
| `web-bff/publicRoutes.test.ts` | New. 9 tests. |
| `web-bff/main.ts` | Calls the public route before the proxy (5 lines). |
| `src/lib/publicPortfolio.ts` | New. Browser reader for the route. |
| `src/lib/publicPortfolio.test.ts` | New. 4 tests. |
| `src/hooks/usePortfolio.tsx` | Slug read uses the public route when signed out, or as fallback. |
| `src/pages/Portfolio.tsx` | Uses the work that came with the answer (2 lines). |
| `src/components/portfolio/ProvenWork.tsx` | Optional `rows` input. Without it, behaviour is unchanged. |
| `.github/workflows/web-bff-ci.yml` | Adds the new test file to the gateway security gate. |

### 2.4 Schema check

No schema object was invented and no migration is needed. Everything the route uses already exists in the repository's migrations:

| Object | Where it is defined |
|---|---|
| `student_portfolios.slug, is_public, bio, skills, achievements, student_id` | stage 8 |
| `student_profiles.status, profile_visibility, full_name, profile_photo_url, total_xp` | stage 1 |
| `portfolio_work(uuid)`, callable by the server role | migration 63 |
| Gateway server credential (`service_role`) | already used for sessions (migrations 95, 96) |

**Not proven yet:** that the live staging database answers these two reads for the gateway's credential. It cannot be proven without deploying or using a service credential, and neither was done. If it does not, the route answers 404 (safe), and the page shows "Portfolio Not Found" as today.

### 2.5 Decisions for the owner

1. **Scorecard for strangers.** Left out. Migration stage 48 removed it for signed-out callers and asked for a decision. The student toggle text says the scorecard is included. Either add it to the allowlist later or change the text. Signed-in owner, college and admin still see it.
2. **Visibility rule.** A portfolio is public only when the profile is also set to "Anyone with the link". This is stricter than the signed-in rule (which checks `is_public` only). Say so if you want the looser rule.
3. **No slug writer exists.** No code or database trigger sets `slug`. Only test data has slugs. In production, "Share Portfolio" will say there is no link until slugs are created. That needs a migration, so it was not done here.
4. **No rate limit** on the new route (the gateway has none anywhere). Cost per call is two small reads.

## 3. Architecture freeze

Checked by the list of changed files: none is under `src/components/dashboard/`, none is a route, sidebar or navigation file, `src/App.tsx` is untouched.

| Dashboard | Menu (unchanged) |
|---|---|
| Student | Floor, Build-log, Squad, Profile |
| College / TPO | Home, Students, Squads, Insights |
| Company | Home, Talent, Lots, Hiring |
| Admin | Home, People, Work, Operations |

`ProvenWork` is also used inside Student > Profile > Portfolio. That call passes no `rows`, so it runs exactly as before. No retired module was restored (legacy guard: 0 occurrences). This is a code-level check; the signed-in screens were not opened in a browser because there are no test logins.

## 4. Integration inventory

### 4.1 Where each change lives

| Change | Origin | Commit | In GitHub | On staging | State |
|---|---|---|---|---|---|
| Managed accounts, session revocation, guards | TEJA + SIDHU | `38cd3f8` … `bf10ad2` | Yes (review branches) | Database: per earlier reports. Site and gateway: **no** | Integrated in base |
| S23 `/health`, fail-closed `/ready` | TEJA | `13771d2` | Yes | Canary only, 0% traffic (`00005-wuh`, tag `s23`) | Integrated in base |
| S24 staging preflight | TEJA | `851cf7e` | Yes (`review/teja-s24-bff-preflight-2026-10-09`) | Not a deployable | Integrated in base |
| S25 identity + production preflights (5 files) | TEJA | none (uncommitted, zip only) | **No** | Not a deployable | Review package only |
| S26 browser QA harness | SIDHU | unknown | **No** | Not a deployable | **Not on this laptop** |
| S27 public portfolio (9 files + this report) | TEJA | none (uncommitted) | **No** | **No** | Ready for review |

`main` on GitHub is `d814d5d`. The base commit is 79 commits ahead of it. Nothing here is on `main`, so nothing here is in production.

### 4.2 Integration manifest

| Source | Files | Conflict risk | Tests required | Deploy dependency | Rollback |
|---|---|---|---|---|---|
| S27 | 9 files in 2.3 | None with S25 (no shared file). With S26: only if S26 edits `usePortfolio.tsx`, `Portfolio.tsx`, `web-bff/main.ts` or `web-bff-ci.yml` | Gateway 95, frontend 135, typecheck, build, browser gate | Gateway must be deployed **before** the site (old gateway answers 404, page shows Not Found) | Section 7 |
| S25 | 2 scripts, 2 test files, 1 report under `scripts/dev-tools/` and `docs/teja-release/` | None (all new files) | 25 + 27 unit tests | None. Tools only | Delete the 5 files |
| S26 | Unknown | Unknown until received | Its own 42 tests, plus the full gate | Unknown | Unknown |

S25 zip was opened read-only: 5 files plus a summary, same as the S25 worktree.

### 4.3 S26 transfer needed

No S26 file exists on this laptop (searched Downloads, Desktop, Documents) and no S26 branch exists on GitHub. To integrate it, one of:

1. SIDHU pushes a branch to `manitejakanuri1/prooflaab`, based on `851cf7e`. Preferred: Git then shows the exact diff.
2. SIDHU sends the zip. Put it in `C:\Users\manit\Downloads\`. Include the base commit it was made on and a list of changed files.

Nothing from S26 was guessed or rebuilt.

### 4.4 GitHub against staging (measured)

| Part | Live on staging | Base commit `851cf7e` | Same? |
|---|---|---|---|
| Website | Entry file `index-BbfwBTK1.js`, Hosting version `939a668ef6990b38`, released 8 Oct 15:18 IST | A staging build of the base gives `index-DdWpc_HC.js` | **No** |
| Website source | Matches the build folder in worktree `prooflabai-security-integration` (commit `59235dd`, built 8 Oct 15:10 IST; that worktree also has uncommitted edits) | 11 commits later; 5 website files differ (sign-in form, route guard, onboarding, home page) | **No** |
| Gateway, 100% traffic | Revision `00004-9nn`, 7 Oct. No `/health`, no account re-check, no public route | Has all of these | **No** |
| Gateway, canary | Revision `00005-wuh`, tag `s23`, 0% traffic. `/health` 200, `/ready` 503 (closed, as designed) | Same as base by timing; images carry no commit label | Likely yes |
| `/api/**` rule | Present, points at `prooflab-staging-web-bff` | Same | Yes |

So today's staging runs an older site on an older gateway. The managed-account sign-in changes in the base commit have **not** been tried on staging through the website.

## 5. Release candidate checks (run in the S27 worktree)

| Check | Result |
|---|---|
| `git diff --check` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` (production settings) | PASS |
| Staging build (`vite build --mode staging`) | PASS, entry `index-ZGxyRX16.js` |
| Frontend unit tests | PASS 135/135 (131 before + 4 new) |
| Gateway tests, deploy gate form (`deno test web-bff/`) | PASS 95/95 (86 before + 9 new) |
| Gateway tests, security gate form | PASS 78/78, readiness 17/17, `deno check` PASS |
| Auth bridge tests | PASS 15/15 |
| Release guard, migration guard, API key, runner config tests | PASS (4 files) |
| Secret scan (includes the new files) | 0 findings in 1,106 files |
| Legacy guard | 0 active occurrences |
| Migration check (`scripts/migrations.py check`) | 104 migrations, 0 problems. No migration added. |
| Browser security gate on both builds | PASS |
| New tests fail without the fix | Confirmed: the test file did not load before `publicRoutes.ts` existed |
| Docker image build | NOT RUN (Docker is not installed on this laptop). CI runs it. |
| Anonymous staging check (today's live staging) | `/api/db/*` 401, `/api/files/*` 401, session `null`, `/api/public/portfolio/*` 404 (route not deployed yet) |
| Five signed-in journeys | **BLOCKED**. Identity fixtures 0/5 ready (S25). |

Mocked tests prove the code's rules. They do not prove a real staging sign-in.

## 6. Staging deployment path

### 6.1 How it works today

| Question | Answer |
|---|---|
| Which branches run CI? | Every push and pull request runs `deploy.yml` (tests, typecheck, build). `web-bff-ci.yml` runs when `web-bff/**` changes. |
| Does a push deploy? | Only a push to `main`, and only to **production**, and only past the release guard. No branch deploys staging. |
| How is staging deployed? | By hand from a laptop. Site: `scripts/deploy-hosting.py`. Gateway: `gcloud run deploy --source web-bff`. |
| How is the `/api/**` rule made? | `deploy-hosting.py` writes it into each Hosting version from `BFF_SERVICE`. The guard refuses a staging site with a non-staging gateway. |
| How is the deployed commit identified? | It is not stamped. Site: compare the entry file name with a local build. Gateway: revision name and image digest. Write both down at deploy time. |
| Which revision serves the gateway? | `prooflab-staging-web-bff-00004-9nn` (100%). |

### 6.2 Commands prepared (none has been run)

Run from `C:\Users\manit\Downloads\prooflabai-mvp\prooflabai-claude-s27`. Each step needs its own yes.

**Step A — save and share the code (no deploy happens).**

```bash
git add web-bff/publicRoutes.ts web-bff/publicRoutes.test.ts web-bff/main.ts \
  src/lib/publicPortfolio.ts src/lib/publicPortfolio.test.ts src/hooks/usePortfolio.tsx \
  src/pages/Portfolio.tsx src/components/portfolio/ProvenWork.tsx \
  .github/workflows/web-bff-ci.yml docs/teja-release/S27-STAGING-INTEGRATION-AND-ARCHITECTURE-FREEZE.md
git commit -m "fix(portfolio): narrow public read route for published portfolios"
git push prooflaab fix/teja-claude-s27-staging-integration-2026-10-09
```

Then wait for both CI runs to go green (this is where the Docker build runs).

**Step B — staging gateway as a canary, 0% traffic.**

```bash
gcloud run deploy prooflab-staging-web-bff --source web-bff \
  --project prooflab-508214 --region asia-south1 --no-traffic --tag s27
```

Check the canary (`https://s27---prooflab-staging-web-bff-ysn2mpe6sa-el.a.run.app`):

| Address | Expect |
|---|---|
| `/health` | 200 `{"ok":true,...}` |
| `/api/public/portfolio/load-student-1` | 200 JSON with a name and `work`, no id or email |
| `/api/public/portfolio/no-such-person` | 404 `{"error":"not found"}` |
| `/api/db/student_portfolios` | 401 |
| `/ready` | 503 (stays closed until the release switch is set; that is correct) |

If the second line is 404, stop: the staging database is not answering the gateway's read. Nothing is harmed; report it.

**Step C — send staging traffic to the canary.** This also switches staging to the newer sign-in code from the base commit for the first time.

```bash
gcloud run services update-traffic prooflab-staging-web-bff \
  --project prooflab-508214 --region asia-south1 --to-tags s27=100
```

**Step D — staging website.**

```bash
npx vite build --mode staging --outDir dist-staging
HOSTING_SITE=prooflab-staging BFF_SERVICE=prooflab-staging-web-bff python scripts/deploy-hosting.py dist-staging
```

**Step E — verify.**

1. `https://prooflab-staging.web.app/` serves the entry file named in `dist-staging/index.html`.
2. `https://prooflab-staging.web.app/portfolio/load-student-1` shows a name and "Proven work", signed out.
3. `https://prooflab-staging.web.app/portfolio/no-such-person` shows "Portfolio Not Found".
4. `python scripts/dev-tools/staging_bff_preflight.py` and SIDHU's anonymous browser run.
5. Sign-in and protected screens: only when real test logins exist. Until then, BLOCKED.

Order matters: B and C before D. The new site on the old gateway shows "Portfolio Not Found" (no worse than today).

## 7. Rollback (staging)

| What | Command | Known-good target |
|---|---|---|
| Gateway traffic | `gcloud run services update-traffic prooflab-staging-web-bff --project prooflab-508214 --region asia-south1 --to-revisions prooflab-staging-web-bff-00004-9nn=100` | `00004-9nn` (image digest `sha256:816aabe9…56cd7`) |
| Website | Release the previous version again through the Hosting API: `POST sites/prooflab-staging/releases?versionName=sites/prooflab-staging/versions/939a668ef6990b38` | Version `939a668ef6990b38` |
| Code | `git revert` the S27 commit on the branch | `851cf7e` |
| Database | Nothing to roll back. S27 changes no data and no schema. | — |

Both targets were read from the live project today. The website rollback has no script yet; it is one API call with the gcloud sign-in.

## 8. Remaining launch blockers

1. No real test logins: 0 of 5 fixtures ready, so the four signed-in journeys are unproven.
2. Staging runs old code: the base commit's sign-in changes are untested on staging.
3. S26 not received, not validated.
4. S25 and S27 are uncommitted and not in GitHub.
5. Production has no gateway, no `/api/**` rule, no signing configuration (S25: 6 of 19).
6. Production migrations 95–102 unverified. Never apply them on a guess.
7. Four infrastructure drift items still await owner approval (S24).
8. Portfolio slugs: nothing creates them (section 2.5, item 3).

## 9. Not touched

Production. Staging services, traffic, Hosting and database. Identity accounts, including the existing Admin login. IAM, secrets, signing keys. Migrations. The TEJA, S23, S24, S25 and SIDHU worktrees. No commit, no push.

One read-only `git fetch prooflaab` was run to compare branches. A local `npm ci` and two local builds were made inside the S27 worktree (ignored folders).
