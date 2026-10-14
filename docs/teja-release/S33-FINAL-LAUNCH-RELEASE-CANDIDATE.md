# S33 — Final launch release candidate

Date: 9 October 2026. Laptop: TEJA. Worktree: `prooflabai-claude-s33`.
Branch: `fix/teja-claude-s33-launch-rc-2026-10-09`. Base commit: `851cf7ecca4ff92be2e1507cca9476a33c057728`.

**Nothing was committed, pushed, deployed, migrated or published. No IAM, secret or traffic change. R18 was read only and is unchanged.**

One read-only production check was run: `scripts/dev-tools/production_bff_preflight.py` (it lists services and makes anonymous GETs; it changes nothing).

## 1. The answer first

| Question | Answer |
|---|---|
| Is there one release candidate? | Yes. R18's uncommitted work, reproduced exactly in S33, plus one fix. It builds, and every local check passes. |
| Was a release blocker found in R18? | Yes, one. The gateway CI step would have failed on the first push. Fixed (section 2). |
| Does the production gateway exist? | **No.** Confirmed today: the service list was read successfully and `prooflab-web-bff` is not in it. |
| Why does production `/api/db` return the app page? | Production Hosting has no `/api/**` rule, because there is no gateway to point it at. The live site is the old build, which does not use `/api`. **It is not an outage today.** It becomes one the moment the new site is published without the gateway. The release guard blocks that. |
| Can the gateway simply be deployed to production? | **No.** It needs the production login bridge to sign with its own key first. That is the token change planned as "Stage 6, a later day" in the rollout checklist. The order in that checklist no longer works for this release (section 5). |
| Is the candidate ready to launch? | The **code** is ready for review. The **launch** is blocked by infrastructure and approvals (section 9). |

## 2. Issues confirmed and fixed

| # | Level | Issue | Fix |
|---|---|---|---|
| 1 | P1 (blocks CI) | `web-bff/routeContract.test.ts` (as changed in R17B) reads `main.ts` from disk. The gateway CI step runs with setting names only and **no file-read permission**, the same as the container. The step failed: 31 passed, 1 failed (`NotCapable: Requires read access`). The wider test command in `deploy.yml` grants file reads, so it passed there and hid this. | The test now proves the public route is wired by behaviour: a write to that path is answered 405 only by the public handler. No file read. Proved it still catches the fault: with the route unwired the test fails ("public portfolio handler is not wired"). |
| 2 | P0 (plan) | `docs/PRODUCTION-ROLLOUT-CHECKLIST.md` publishes the website (Stage 4) before the token change (Stage 6.1) and never mentions the gateway. With this candidate that order cannot work. | Not edited (it is an owner document). The corrected order is section 5 of this report. |

Nothing else was changed. No product screen, route or dashboard file was touched by S33.

## 3. Exact changed files

Against R18 (what S33 adds):

| File | Change |
|---|---|
| `web-bff/routeContract.test.ts` | 13 lines replaced by 11 (issue 1) |
| `docs/teja-release/S33-FINAL-LAUNCH-RELEASE-CANDIDATE.md` | this report (new) |

Against the base commit, the whole candidate: 16 modified and 37 new files. The full list with checksums is `RC-FILE-INVENTORY.txt` in the review ZIP. By origin:

| Origin | What |
|---|---|
| S27 + R9 + R17B | Signed-out portfolio route, private-by-default portfolio |
| R2 | Student "View Submission" to the Build-log entry |
| S31 | Student profile retry storm fix and failure screen |
| S32 | Route contract, Hosting rewrite list and tests, staging rollback plan |
| S25, S29 | Read-only Identity and production preflights |
| Sidhu S30 | Migration 103 with rollback, proof-integrity checks in the two submit functions, offline permission tests |

R18 protection: its uncommitted state was saved first as one patch in `prooflabai-mvp\r18-claude-final-backup-20261009\` (52 entries, sha256 `2b0a0a13…b09b`). S33 was built from that patch and compared file by file with R18: identical.

## 4. Tests

| # | Check | Result |
|---|---|---|
| 1 | `git diff --check` (new files included) | PASS |
| 2 | Secret scan (new files included) | PASS, 0 findings |
| 3 | Legacy guard | PASS, 0 active occurrences |
| 4 | `python scripts/migrations.py check` | PASS, 105 migrations, 0 problems |
| 5 | Atomic migration guard | PASS 6/6 |
| 6 | Release guard tests | PASS 17/17 |
| 7 | Hosting rewrite tests | PASS 4/4 |
| 8 | Google API key, runner configuration tests | PASS 3/3, 2/2 |
| 9 | Staging preflight, rollback plan unit tests | PASS 31/31, 5/5 |
| 10 | Identity, production preflight, five-role unit tests | PASS 25/25, 27/27, 32/32 |
| 11 | Frontend unit tests | PASS 153/153 |
| 12 | TypeScript typecheck | PASS |
| 13 | Gateway tests, all | PASS 110/110 |
| 14 | Gateway CI security step (no permissions) | PASS 78/78 |
| 15 | Gateway CI settings-only step | **FAIL before the fix (31/1). PASS after: 32/32** |
| 16 | `deno check web-bff/main.ts` | PASS |
| 17 | Server function tests (`_shared`, `transcription-reap`) | PASS 179/179 |
| 18 | Type-check of every server function | PASS |
| 19 | Auth bridge tests, files service tests | PASS 15/15, 16/16 |
| 20 | Accounts, transcription worker, transcriber Python tests | PASS (all four files) |
| 21 | Sidhu S30 permission model | PASS 14/14 |
| 22 | Sidhu S30 real-Postgres harness | **1 passed, 17 SKIPPED** here: the PGlite package is not installed in this worktree. R18's own log reports a full run; not re-verified by me. |
| 23 | Production build, staging build | PASS, PASS |
| 24 | Browser security gate on both builds | PASS, PASS |
| 25 | Release guard dry runs on the real builds | PASS: production refused without approval and gateway address; a staging build refused for production; staging allowed |
| 26 | **Live, read-only:** production gateway preflight | **FAIL 6 of 19** (expected; section 6) |

| Skipped | Why |
|---|---|
| Staging S1 to S4B (coding and written submissions) | Already passed; not rerun, as instructed |
| Docker build and container steps of the gateway CI | Docker is not installed here. CI runs them. |
| Signed-in browser tests | Sidhu's lane |
| Anything that deploys, migrates, publishes or moves traffic | Not authorised |

## 5. The corrected launch order

The website in this candidate signs in and reads data **only** through `/api/**`. So the gateway must work in production before the site is published, and the gateway needs the bridge's own signing key before it can work.

```
A. Backups, drift closed
B. Database: 50 ... 91 (checklist order), then 92, 93, 95, 96, 97, 98, 100, 101, 102, 103
C. Service images (checklist Stage 3), functions AFTER 103
D. Token change, first half (checklist 6.1): bridge signs with its own key; API accepts new AND old keys
E. Production gateway: create, check, turn the release switch on, /ready = 200
F. Owner sets the three release variables for the exact commit
G. Website publish (release guard runs first)
H. Checks. Later, on another day: token change second half (old key removed), scheduler change
```

The old checklist has G before D. With this candidate that publishes a site nobody can sign in to. The release guard would refuse it (no gateway answers `/health`), so the failure mode is "release blocked", not "site broken".

## 6. Production gateway: what is missing (checked live today)

| Group | Result | Meaning |
|---|---|---|
| Gateway service `prooflab-web-bff` | **Not deployed** (7 checks fail on this) | Create it (step E) |
| Bridge signs with its own key (`APP_SIGNING_KEY`) | **Not set** | `/service-token` answers 401, so the gateway cannot read its session store |
| Bridge `SERVICE_TOKEN_AUDIENCE`, `SERVICE_TOKEN_CALLERS` | **Not set**, 0 callers | Same |
| No staging identity is a production caller | PASS | |
| `prooflab.co.in/api/auth/session` and `/api/db/profiles` | **App page, HTTP 200** | No `/api/**` rule yet |
| Bridge, functions, accounts, transcriber, files health | PASS (5) | The backends are up |

### Gateway dependencies

| Dependency | Production today | Needed |
|---|---|---|
| Auth bridge | Signs with the shared secret only | Own signing key, audience, callers list including the gateway's account (step D) |
| API (PostgREST) | Accepts the shared secret only; no suspended-account check | Key set = bridge public key **plus** the old key; `PGRST_DB_PRE_REQUEST=public.refuse_suspended` |
| Functions, files, accounts, transcriber, transcription worker | Verify with the shared secret | `APP_JWT_PUBLIC_JWKS`, `SIGNER_URL`; functions and files also `FILE_GRANT_SECRET` |
| Session store | Table `web_sessions` | Migrations 95, 96 (and 101, 102 for revocation and student access) |
| Service identity | - | New account `prooflab-rt-webbff`, **no project roles** |
| Secrets | - | New `prooflab-web-bff-session-key` (gateway only) and a production app signing key (bridge only). Never the staging ones. |
| Hosting | No `/api/**` rule | Written by `deploy-hosting.py` when `BFF_SERVICE` is set |
| GitHub | Variables unset | `PRODUCTION_BFF_SERVICE`, `PRODUCTION_BFF_HEALTH_URL`, `PRODUCTION_RELEASE_APPROVED_SHA` |

Source of the "production today" column: `infra/production/services.json` in the repository compared with `infra/staging/services.json`, plus today's live check. The staging gateway itself is not in the snapshot.

### Step E, prepared commands (NOT run)

Each needs your yes. Before running, read the live staging gateway (`gcloud run services describe prooflab-staging-web-bff`) and confirm the limits and setting names match; I did not read it.

```bash
P=prooflab-508214; R=asia-south1; SA=prooflab-rt-webbff@$P.iam.gserviceaccount.com

# E1. Own account, no project roles
gcloud iam service-accounts create prooflab-rt-webbff --project $P --display-name "ProofLab web gateway"

# E2. Session key: 32 random bytes, production only. The value is never shown.
python -c "import secrets,sys; sys.stdout.write(secrets.token_urlsafe(32))" | \
  gcloud secrets create prooflab-web-bff-session-key --project $P --replication-policy automatic --data-file=-
gcloud secrets add-iam-policy-binding prooflab-web-bff-session-key --project $P \
  --member serviceAccount:$SA --role roles/secretmanager.secretAccessor

# E3. Add $SA to the production bridge's SERVICE_TOKEN_CALLERS (part of step D; one list, comma separated)

# E4. Build the image from the approved commit, then deploy BY DIGEST
IMG=$R-docker.pkg.dev/$P/cloud-run-source-deploy/prooflab-web-bff:rc-$(git rev-parse --short HEAD)
gcloud builds submit --project $P --tag $IMG web-bff
gcloud run deploy prooflab-web-bff --project $P --region $R \
  --image <IMG@sha256 digest printed by the build> \
  --service-account $SA --allow-unauthenticated \
  --cpu 1 --memory 512Mi --timeout 60 --max-instances <same as staging> \
  --set-secrets SESSION_KEY=prooflab-web-bff-session-key:1 \
  --set-env-vars "^|^GOOGLE_API_KEY=<the public browser key in .env.production>|AUTH_BRIDGE_URL=<bridge address, EXACTLY equal to its SERVICE_TOKEN_AUDIENCE>|POSTGREST_URL=<prooflab-api address>|FUNCTIONS_URL=<prooflab-functions address>|FILES_URL=<prooflab-files address>|ACCOUNTS_URL=<prooflab-accounts address>|TRANSCRIBER_URL=<prooflab-transcriber address>|BROWSER_ORIGINS=https://prooflab.co.in,https://www.prooflab.co.in,https://prooflab-508214.web.app"
# BFF_RELEASE_READY is NOT set yet.
```

Checks, in order, on the gateway's own address:

| # | Check | Expect |
|---|---|---|
| E5 | `/health` | 200 `{"ok":true,"service":"prooflab-web-bff"}` |
| E6 | `/ready` | 503 (switch off) |
| E7 | `/api/auth/session`; `/api/db/profiles` | 200 `{"session":null}`; 401 |
| E8 | Set `BFF_RELEASE_READY=true`, then `/ready` | **200, state `ready`**. If it names a failed part, fix that part. Do not go on. |
| E9 | `python scripts/dev-tools/production_bff_preflight.py` | Every line PASS except the two `site:` lines (those pass after step G) |
| E10 | One real sign-in with the smoke student on the gateway address | Works |

The switch (E8) is the only way `/ready` opens. Nothing in this candidate weakens it, the sign-in check, the origin check or the release guard.

## 7. Migration dependencies

Order for the files after 91: `92 → 93 → 95 → 96 → 97 → 98 → 100 → 101 → 102 → 103`. There is no 99.

| Migration | Needed by | Note |
|---|---|---|
| 92, 93 | Coding checks | 93 applied and verified on staging (your report) |
| 94 | Nothing in this release | It **drops two unused tables**. Deleting needs its own yes. Not required for launch. |
| 95, 96 | The gateway (sessions, managed sign-in) | Gateway `/ready` cannot be 200 without them |
| 97, 98 | Admin and college account creation | |
| 100 | 103 requires it | Its file header still says "NOT APPLIED ANYWHERE". That line is stale for staging: 103 is applied there and requires 100. |
| 101, 102 | Session revocation, student access; 102 requires 96 and 101 | Header of 101 is stale in the same way |
| 103 | The two submit functions | **Apply 103 before deploying the functions.** They read the new column `tasks.inserted_by`. |

Compatibility of 103 with the website in this candidate (checked in the source):

| 103 changes | Does the website depend on the old rule? |
|---|---|
| Students can no longer insert or update `tasks` directly | No. A student starts a task through the `start_task_assignment` function, and submits through the two functions. No student screen writes `tasks`. |
| College task insert must be for its own students | The college Assign Tasks screen inserts exactly that. This was broken before 103 and is repaired by it. |
| `user_roles` self-claim removed | Sign-up is already switched off at the gateway (403). The wizards only update their own "wizard finished" flag. |
| Job posts by a company are forced to `pending` | The company screen already sends `pending`. |
| Signed-out read of `public_resume_scorecards` removed | The signed-out portfolio does not read it (S27 left the scorecard out). |

**Not verified:** which migrations production has. The repository notes say production was at 49 on 1 October and has no ledger table. Read it before step B: `select to_regclass('public.schema_migrations')`, then the ledger rows. Never apply on a guess.

Rollback of 103 reopens the holes it closes (Sidhu's note). Treat it as an incident measure.

## 8. Build readiness

| Item | Value |
|---|---|
| Source revision | One commit on this branch, parent `851cf7ecca4ff92be2e1507cca9476a33c057728`. Its id is `git log -1 --format=%H`. Approve by that full id. See `RC-DEPLOYMENT-MANIFEST.md`. |
| Production build | PASS. 183 files. Entry `assets/index-Cw_4XOQg.js`. Checksum list in the ZIP (`dist.sha256`). |
| Staging build | PASS. 183 files. Entry `assets/index-DCsUlCP4.js`. |
| Backend address inside either build | None |
| Tracked file inventory | `RC-FILE-INVENTORY.txt` in the ZIP (every file of the candidate with its Git blob id) |

The entry file names will change when the candidate is committed and rebuilt by CI. CI's build is the one that ships, not this laptop's.

## 9. Remaining blockers

| # | Blocker | Owner |
|---|---|---|
| 1 | Candidate is committed locally but not pushed; CI (with Docker) has not run on it | Teja |
| 2 | Production bridge has no own signing key; API and five services still on the shared secret (step D) | Teja, with your yes |
| 3 | Production gateway does not exist (step E) | Teja, with your yes |
| 4 | Production migration state unknown; 50 to 103 to apply in order | Teja, with your yes |
| 5 | Staging normal traffic is still on the old revisions; gateway `/ready` on staging has never been seen at 200 against real backends | Teja |
| 6 | Five-role signed-in run on staging | Sidhu |
| 7 | Sidhu's AI-first policy patch not received | Sidhu |
| 8 | Rollout checklist order is out of date (section 5) | Owner to accept the new order |
| 9 | Owner decisions still open: the student failure screen (S31), public-by-default portfolios once slugs exist, migration 94, four drift items (S24) | Owner |

## 10. Rollback

| What went wrong | Action | Notes |
|---|---|---|
| Site after publish | Re-release the previous Hosting version | `docs/DISASTER-RECOVERY-RUNBOOK.md`. Write down the current version id **before** step G. |
| Gateway revision | Send traffic back to the previous revision, or turn `BFF_RELEASE_READY` off | A brand-new service has no previous revision: the rollback is the site rollback. |
| Token change (step D) | Remove `APP_SIGNING_KEY` from the bridge; put the API back on the old key | The riskiest step. Do it alone, with this ready. While the API accepts both keys, old tokens keep working. |
| A migration | Its own `migration/NN-rollback-*.sql`, newest first | 103's rollback reopens security holes. For 73, remove the API pre-request setting first. |
| Functions | Previous revision | Safe only if 103 stays applied (old functions do not read the new column). |
| Staging | `python scripts/dev-tools/staging_rollback_plan.py ...` prints the commands | |
| This candidate | Nothing is committed. R18 is unchanged; S33 can be removed. Ask first. | |

After the site is published every user signs in once more (cookies are new). That is expected, not a fault.

## 11. Sidhu's patch: how it will be reviewed

Not received, so not integrated. When it arrives it is applied to a copy first and must pass, before it touches the candidate:

1. Its base commit and file list are stated; no file outside its scope.
2. `migrations.py check`, secret scan, legacy guard, `git diff --check`.
3. All of section 4, with no test removed or weakened.
4. No change to gateway sign-in, origin checks, `/ready` or the release guard.
5. If it adds a migration: a rollback file, a self-check, and its place in the order of section 7.
6. No AI job without the cost stated first.

## 12. Handoff to Teja release operations

1. Review the two S33 changes. Apply `S33-on-top-of-R18.patch` to R18 (or use S33 as the candidate).
2. Commit on a release branch. Push to `prooflaab` only, **not** `main`. Wait for both workflows, Docker steps included.
3. Staging: send traffic to the new functions revision (`s30v2`) and the new gateway; set the staging release switch; see `/ready` at 200; Sidhu's signed-in run.
4. Read the production migration ledger (read-only). Fix the order of section 7 against what is really there.
5. Get the owner's yes for steps A to G, one by one.
6. Run A to E. Stop at any failed check.
7. Owner sets the three variables for the exact commit. Merge to `main` only then.
8. After publish: `production_bff_preflight.py` must be all PASS, `healthcheck.py` all PASS, smoke sign-in.

## Not touched

Production and staging services, traffic, Hosting, databases, Identity, IAM, secrets. The R18 worktree and every other worktree. No commit, nothing staged.
