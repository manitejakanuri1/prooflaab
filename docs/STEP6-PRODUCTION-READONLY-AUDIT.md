# Step 6 — Production READ-ONLY Audit (2026-09-30)

| | |
|---|---|
| Prompt | `ProofLabAI_Step6_Production_ReadOnly_Audit_Prompt.md` |
| Repository / branch / head | `manitejakanuri1/prooflaab`, `work/step6j-release-gates`, `a16aab271cb255df8ded39a53ffc69826f06901c` |
| Production live frontend commit | prooflaab `main` `ee0143c0be79b2cd50e33626155b5aa0ee426b8d` (2026-09-22) |
| Evidence | `STEP6-PRODUCTION-READONLY-AUDIT-commands.txt` (every command), `STEP6-PRODUCTION-READONLY-AUDIT-output.txt` (every output) |
| Owner SQL (not run) | `STEP6-PRODUCTION-READONLY-AUDIT-owner-studio.sql` |
| Changes made to production | **None.** Only list / describe / get-iam-policy commands, anonymous public GETs, and `git`/`gh` reads. |
| Committed / pushed | **No.** |

## Summary in plain English

- **Production today runs the OLD synchronous voice flow.** The live website does not contain any Step 6 async code, and production has no queue, no worker and no recovery job.
- **The production database already has the Step 6 columns.** Seen from the public API description. The live function bodies (including which Migration 45 is there) could **not** be checked by Claude, because that needs a database login. The owner must run the prepared read-only SQL.
- **Security:** four IAM issues, none of which is new with Step 6:
  1. the default compute account has Editor on the whole project and runs every production service;
  2. the Firebase admin account can impersonate other accounts;
  3. a staging account can administer the shared login system;
  4. a staging account can connect to Cloud SQL project-wide.

## Part 1 — Production target (proved)

| Item | Value | How proved |
|---|---|---|
| GCP project | `prooflab-508214` (number 135298577404), active | `gcloud projects describe` |
| gcloud account | `deploy.openfloor@gmail.com` (project Owner) | `gcloud config list` |
| Region | `asia-south1` | every resource |
| Production Cloud SQL | `prooflab-db`, Postgres 17, zonal, RUNNABLE | `gcloud sql instances list` |
| Production database | `prooflab` (also `postgres` and a leftover `restoretest` database on the same instance) | `gcloud sql databases list` |
| Staging (excluded) | `prooflab-staging-db` and every `prooflab-staging-*` resource | name prefix |
| Firebase site | `https://prooflab.co.in` (Hosting API returned 403 for ADC quota; site checked by public GET) | Part 12 |
| Production Cloud Run services | prooflab-functions, -files, -api, -auth-bridge, -transcriber, -accounts, -code-runner | `gcloud run services list` |
| Production Cloud Run jobs | prooflab-bug-finder, prooflab-crawler (`prooflab-staging-inspect4` is staging) | `gcloud run jobs list` |
| Cloud Tasks queues | **none for production** (only `prooflab-staging-ai-background`, `prooflab-staging-transcription`) | `gcloud tasks queues list` |
| Scheduler | 11 production jobs + 1 staging (`prooflab-staging-transcription-reap`) | `gcloud scheduler jobs list` |

**Ambiguity check:** production and staging share one GCP project, so they are told apart only by the `staging` name prefix. The prefix is used consistently, and the production website bundle contains **only** production URLs (no `staging`). The production API service has `prooflab-db` attached. Result: **no ambiguity**.

## Part 2 — Backups (read-only)

| Item | Value |
|---|---|
| Automated backups | enabled, daily window 20:00 UTC, 7 retained |
| Latest successful | 2026-09-29 20:00–20:29 UTC, AUTOMATED, SUCCESSFUL |
| On-demand backups | 2026-09-28 11:42 UTC and 13:58 UTC (SUCCESSFUL) |
| Point-in-time recovery | **enabled**, transaction logs kept 7 days |
| Deletion protection | **true** |
| Other | IAM database auth flag on; public IPv4 on; `sslMode ENCRYPTED_ONLY` |

**A usable rollback point exists.** Before any future production change, take a fresh on-demand backup. That is a write, so it was not done here.

## Part 3 — Production Cloud SQL (columns) — PARTIAL

**Claude could not open a read-only SQL session on production.** Doing so needs either:
- the `prooflab-db-uri` secret, which Claude must never read; or
- a new login / IAM user / Cloud Run job on production, which is a change.

Both are forbidden, so all SQL checks are in `STEP6-PRODUCTION-READONLY-AUDIT-owner-studio.sql` for the owner to run in Cloud SQL Studio. That script:
- uses `BEGIN TRANSACTION READ ONLY … ROLLBACK`;
- runs SELECTs and COUNTs only;
- checks that Q0 must show `transaction_read_only = on`.

**What WAS verified without a login:** the production PostgREST API publishes its table description to anonymous callers. A plain GET with no token, read-only, showed these columns on `voice_explanations`:

| Column | Type (API) | Default | From migration |
|---|---|---|---|
| transcription_status | text | `completed` | 41 |
| transcription_claimed_at | timestamptz | – | 41 |
| transcription_attempts | int | 0 | 41 |
| transcription_error | text | – | 41 |
| transcription_idempotency_key | text | – | 41 |
| transcription_lease_token | uuid | – | 42 |
| transcription_enqueued_at | timestamptz | – | 43 |
| transcription_reap_claimed_at | timestamptz | – | 43 |
| transcription_reap_attempts | int | 0 | 43 |
| scoring_claimed_at | timestamptz | – | 44 |
| scoring_lease_token | uuid | – | 45 |
| storage_path, status (`recorded`), communication_score, communication_notes | – | – | original |

All 15 expected columns are **present**, so the schema side of 41–45 is on production. Constraints and indexes need the owner script (Q2).

## Part 4 — Live database functions — NOT VERIFIED (owner script Q3/Q4/Q5/Q9)

- **Anonymous check:** none of the 9 Step 6 functions is exposed to `anon` through the API. The API lists 22 `/rpc/` routes and none is voice- or transcription-related. This is consistent with "EXECUTE revoked from PUBLIC/anon", but it is **not** proof of the `authenticated` privileges or of the function bodies.
- **Q9** in the owner script prints, for each function, the live `md5(prosrc)` and which GitHub file it matches. The fingerprint method was validated: it reproduces the staging values exactly.

| Function | 42 / step6u | step6y 43 | 44 | original 45 | **6DD 45 (wanted)** |
|---|---|---|---|---|---|
| claim_transcription_job | `0fba0fd2…` | | | | |
| complete_transcription_job | `a451e952…` | | | | |
| fail_transcription_job | `d3e97e63…` | | | | |
| claim_transcription_recovery | | `babb6d5c…` | | | |
| guard_voice_explanations_insert | | `37f3b71b…` | | | |
| claim_voice_scoring | | | `10980482…` | `8246246…` | **`36e69d5f…`** |
| complete_voice_scoring | | | | `ed6fa70…` | **`7eab326d…`** |
| fail_voice_scoring | | | | `ab4cf7b…` | **`56bd2cd2…`** |

## Part 5 — Migration 45 on production — NOT VERIFIED

- It cannot be classified A/B/C/D without the owner script.
- Handoff notes (not re-verified today) say the corrected 6DD file was run on production on 2026-09-28.
- The two on-demand backups at 11:42 and 13:58 UTC that day fit that story, but they are **not** proof.
- **Decision rule:**
  - Q9 shows `CORRECTED 6DD 45` for all three scoring functions → **C**.
  - `ORIGINAL 45` → **B**.
  - `44 (claim only)` → **A**.
  - `UNKNOWN` → **D**.
- As a second check, the existing `migration/step6dd-migration-45-production-verify-readonly.sql` (read-only) should show every row `ok = true` on production.

## Part 6 — Database security — PARTIAL

- **Verified (anon, via API):** `anon` can see the `voice_explanations` definition. PostgREST shows a table to a role only if that role has some privilege on it. Which rows anon can read is decided by RLS, which needs the owner script (Q7).
- **Not verified:**
  - RLS on or forced;
  - the policies;
  - UPDATE rights for anon / authenticated (47 says revoked);
  - EXECUTE for authenticated / service_role / `prooflab_app`;
  - whether the insert guard checks `storage_path` ownership.

  The staging audit showed the guard does **not** check ownership. Production is expected to be the same (step6y guard), which is the known open item N3.

## Part 7 — Production Cloud Run

All services:
- region asia-south1, **ingress all**;
- invoker **allUsers** (public by design; the apps check the JWT themselves);
- 100% traffic on the latest revision;
- min instances 0.

| Service | Revision | Image (tag / digest) | Service account | Max / conc / timeout | CPU / mem | Cloud SQL | Env NAMES | Secret NAMES | Git commit |
|---|---|---|---|---|---|---|---|---|---|
| prooflab-functions | 00044-lnj | `prooflab-functions:v37` / `dc19afa2…` (built 2026-09-22 09:28) | default compute | 4 / 80 / 300 s | 1 / 1Gi | none | ACCOUNTS_URL, ALLOWED_ORIGINS, BACKEND, CODE_RUNNER_URL, EMAIL_FROM, FILES_URL, **GOOGLE_API_KEY (plain)**, POSTGREST_URL, PRIVATE_MOUNT, PUBLIC_MOUNT | code-runner-secret, deepseek-api-key, github-pat, prooflab-jwt-secret, resend-api-key, webhook-secret | **UNKNOWN** |
| prooflab-files | 00011-z5p | `prooflab-files:v-no-vercel` / `7946c270…` | default compute | 4 / 80 / 60 s | 1 / 512Mi | none | ALLOWED_ORIGINS, GCP_PROJECT, PRIVATE_BUCKET, PUBLIC_BUCKET | prooflab-jwt-secret | UNKNOWN (tag only) |
| prooflab-api | 00003-n6c | `postgrest/postgrest:v16.3` (`63b567a4…`) | default compute | 4 / 80 / 30 s | 1 / 512Mi | **prooflab-db** | PGRST_DB_ANON_ROLE, PGRST_DB_POOL, PGRST_DB_SCHEMAS, PGRST_SERVER_PORT | prooflab-db-uri, prooflab-jwt-secret | n/a (upstream image) |
| prooflab-auth-bridge | 00009-4rl | digest `1f082fda…` | default compute | 3 / 80 / 20 s | 1 / 256Mi | none | ALLOWED_ORIGINS, GCP_PROJECT, POSTGREST_URL, TOKEN_TTL | prooflab-jwt-secret | UNKNOWN |
| prooflab-transcriber | 00002-8lk | `prooflab-transcriber:v1` / `29443fe1…` | default compute | 3 / 1 / 120 s | 2 / 2Gi | none | ALLOWED_ORIGINS, WHISPER_MODEL | prooflab-jwt-secret | UNKNOWN (tag only) |
| prooflab-accounts | 00002-bc9 | `prooflab-accounts:v2` / `a982c244…` | default compute | 2 / 80 / 300 s | 1 / 512Mi | none | ALLOWED_ORIGINS, GCP_PROJECT, POSTGREST_URL | prooflab-jwt-secret, webhook-secret | UNKNOWN (tag only) |
| prooflab-code-runner | 00001-rpr | `prooflab-code-runner:v1` / `c27de7ee…` | `code-runner@` | 6 / 1 / 120 s | 2 / 2Gi | none | – | code-runner-secret | UNKNOWN (tag only) |

**Step 6 equivalents on production:**

| Needed | Production |
|---|---|
| transcription-enqueue | **absent**: not on production functions. `/ready` loads 38 functions, and the 38-name list has no `transcription-enqueue` |
| transcription-worker | **absent** (only `prooflab-staging-transcription-worker` exists) |
| transcription-reap | **absent** |
| voice-score | **present** in production functions (the old synchronous scorer, called by the browser) |

**Why functions is UNKNOWN:**
- Production `/ready` reports 38 loaded, 38 expected.
- `main` `ee0143c` lists 37 functions and the Step 6 head lists 39.
- The only commit with a 38-function list is `b1b9004` (2026-09-25). That is **after** the v37 image was built (2026-09-22), and that commit's list includes `transcription-enqueue`, which production does not have.
- So the running functions image does not match any committed function list. It was probably built from an uncommitted working tree.

## Part 8 — Cloud Tasks

**Production has no Cloud Tasks queue.** The two queues in the project are both staging: `prooflab-staging-transcription` and `prooflab-staging-ai-background`. Each has 2 concurrent dispatches, 1/s and 3 attempts. So there is no production queue → worker hop to check.

## Part 9 — Recovery / Scheduler

- **No production transcription recovery exists**, for either case:
  - pending rows never enqueued;
  - stale processing rows.
- The only reaper is `prooflab-staging-transcription-reap`. It runs every minute and targets the staging functions.
- Production scheduler jobs, all ENABLED; the last attempts today show no error code:

| Job | Schedule | Target |
|---|---|---|
| prooflab-accounts-sync | `*/10 * * * *` | accounts `/sync` |
| prooflab-nightly-squads / daily-lots / extend-fixtures / prune-events | daily | functions `/scheduled-job?job=…` |
| prooflab-weekly-plan / weekly-seasons / weekly-progress | weekly | functions `/scheduled-job?job=…` |
| prooflab-crawler-weekly | `10 8 * * 0` | Cloud Run job prooflab-crawler |
| prooflab-bugfinder-run | `0 6,10,14,18,22 * * *` (**5×/day**; notes say 3×) | Cloud Run job prooflab-bug-finder |
| **prooflab-bugfinder-deep-run** | `0 4 * * *` Asia/Kolkata, body sets `DEEP=1` | Cloud Run job prooflab-bug-finder |

**Finding:** the DEEP bug-finder run **is** on a daily schedule, although project notes say it is not. It makes real DeepSeek calls (small daily cost) and resets the t16 test account's resume claims. This is not a Step 6 blocker, but the owner should confirm it is intended.

## Part 10 — File storage / files service

| Item | Value |
|---|---|
| Voice bucket | `gs://prooflab-private-508214` (mounted into prooflab-files and prooflab-functions as `private`) |
| Public access prevention | **enforced**; uniform bucket-level access on; versioning on; soft delete 7 days |
| Bucket IAM | default compute account: objectAdmin; the usual legacy project owner/editor/viewer roles; **no allUsers** |
| Public bucket | `gs://prooflab-public-508214`: **allUsers objectViewer** (public avatars/images, by design; not used for voice) |
| Backups bucket | `prooflab-backups-508214`: public access prevention enforced |
| Files-service identity | default compute account |
| Upload ownership model | the files service writes under the folder named after the JWT `sub` (from code); `storage_path` = `<student_id>/<file>` |
| DB-side ownership check | **not enforced** by the insert guard (N3, from the staging audit); production counts are in owner script Q8 (`PATH_NOT_OWN_FOLDER`) |

No audio was downloaded and no object was listed.

## Part 11 — Authentication / IAM

**Hop map as production works today (synchronous):**

| Hop | Who calls who | Authentication | Service account | Broader than needed? |
|---|---|---|---|---|
| Browser → auth-bridge | student | Identity Platform ID token → ProofLab JWT | default compute | service public (allUsers) by design |
| Browser → files (upload) | student | ProofLab JWT (HS256, prooflab-jwt-secret) | default compute | public; the app checks the JWT |
| Browser → transcriber `/transcribe` | student | ProofLab JWT | default compute | public; the app checks the JWT |
| Browser → PostgREST (insert row) | student | ProofLab JWT, role `authenticated`, RLS | default compute | public; RLS/grants unverified (owner script) |
| Browser → functions `voice-score` | student | ProofLab JWT | default compute | public; the app checks the JWT |
| functions → DeepSeek | server | secret `deepseek-api-key` | default compute | ok |
| Enqueue → Cloud Tasks → worker → recovery | **do not exist on production** | – | – | – |

**Flags:**

| Severity | Finding |
|---|---|
| **HIGH** | `135298577404-compute@developer` (default compute account) has **roles/editor on the whole project** and is the runtime identity of every production service except code-runner. Any code bug in any public service would have near-full project power. |
| **HIGH** | `firebase-adminsdk-fbsvc@` has **roles/iam.serviceAccountTokenCreator at project level**, so it can mint tokens as any account, including the Editor compute account. |
| **HIGH** | Staging account `prooflab-staging-accounts@` has **roles/identitytoolkit.admin project-wide**. Identity Platform is shared by production and staging, so a staging account can administer **production** logins. |
| MEDIUM | Staging account `prooflab-staging-api@` has **roles/cloudsql.client project-wide**, so it can connect to the production instance (it still needs a production password). |
| MEDIUM | `GOOGLE_API_KEY` is a **plain environment value** on prooflab-functions, not a Secret Manager reference. |
| LOW | `deepseek-api-key` is shared between production and staging (the staging functions account can read it). |
| INFO | All 7 production services are allUsers-invokable. This is intended, because they authenticate in-app. There is no production worker endpoint, so there is no public worker. |
| OK | `prooflab-jwt-secret` and `prooflab-db-uri` are readable only by the compute account. No `allAuthenticatedUsers` found anywhere. |
| **INCIDENT (this audit)** | The Part 1 Firebase Hosting check put the owner's short-lived OAuth access token on a logged command line. It was replaced with `<REDACTED-ACCESS-TOKEN>` in both evidence files before copying (0 occurrences remain). The token expires within 1 hour of issue. No action is strictly needed; optionally run `gcloud auth revoke` / `login` to be certain. |

## Part 12 — Production frontend (deployed build)

- Fetched `https://prooflab.co.in` and all 92 JS bundles (public GET). `index.html` was last modified 2026-09-22 13:54 GMT, which matches the prooflaab `main` deploy run at 13:52 UTC for commit `ee0143c`.
- **`VITE_ASYNC_TRANSCRIPTION`:** it does not exist in `main` and is not referenced in the bundle.
- Step 6 async code is **absent** from the bundle:
  - no `transcription-enqueue`;
  - no `pl.voiceJob`;
  - no "Queued"/"Uploading your recording" UI text.
- Old synchronous markers are **present**: `/transcribe`, `voice-score`, "Saving your explanation".
- Endpoints compiled in are production only:
  - prooflab-api;
  - auth-bridge;
  - files (upload);
  - transcriber (`/transcribe`);
  - functions (`voice-score`);
  - accounts;
  - Google identitytoolkit / securetoken / storage.
- There is **no enqueue endpoint**.
- The Step 6 branch is 60 commits ahead of `main`.

## Part 13 — Production data health — NOT RUN (owner script Q8)

Q8 counts:
- total rows;
- each `transcription_status` and `status` value;
- pending with NULL `transcription_enqueued_at`;
- processing stale over 180 s;
- reap attempts ≥ 8;
- server-completed but unscored rows;
- scores outside 0–100;
- scored without score / score without scored;
- paths outside the student folder;
- suspicious paths;
- NULL idempotency keys (all rows and server rows);
- duplicate storage paths.

It returns COUNTS only; no ids, transcripts or names.

**Expected on the old flow:** every row is `transcription_status = completed` (the column default) and has a NULL idempotency key. Any `pending`/`processing` row on production would be unexpected.

## Part 14 — Architecture parity matrix

| Component | GitHub Step 6 expected | Production actual | Match? | Security status | Action needed |
|---|---|---|---|---|---|
| Frontend | async flow behind `VITE_ASYNC_TRANSCRIPTION` | `main` `ee0143c`, sync only, no flag | ❌ | ok | later: deploy Step 6 frontend (flag off first) |
| File service | upload to private bucket, path `<uid>/…` | same model, image `v-no-vercel` (commit unknown) | ✅ (model) | public service, JWT-checked | map image to commit |
| Cloud Storage | private bucket, PAP enforced | enforced, versioned, soft delete | ✅ | ok | none |
| transcription-enqueue | function in functions service | **absent** (38 functions, no enqueue) | ❌ | – | deploy with Step 6 functions |
| Cloud Tasks | prod transcription queue, OIDC to worker | **no production queue** | ❌ | – | create (later, approved) |
| transcription-worker | private Cloud Run, own account, Tasks-only invoker | **absent** | ❌ | – | deploy (later) |
| Cloud SQL migrations | 41, 42, 43, 44, 45(6DD), 47 | **columns of 41–45 present** (API); bodies unverified | ⚠️ partial | – | owner runs read-only SQL |
| transcription RPCs | 42/step6y bodies, service_role only | not exposed to anon; bodies/grants unverified | ⚠️ | – | owner script Q3/Q4/Q9 |
| recovery / reaper | scheduler every minute to `transcription-reap` | **absent** (staging only) | ❌ | – | create (later) |
| voice-score | server-side scoring via lease RPCs | present, **sync** browser-called version | ⚠️ old | JWT-checked | redeploy with Step 6 |
| scoring Migration 45 | corrected 6DD | **unverified** (notes say 6DD, 2026-09-28) | ❓ | – | owner script Q9 |
| Scheduler | + transcription-reap | 11 prod jobs, no reaper; DEEP bug-finder daily | ❌ / note | ok | confirm DEEP schedule intended |
| IAM | least privilege per service | compute account = Editor for all; token creator; staging IdP admin | ❌ | **HIGH** | separate hardening plan |
| Secrets | Secret Manager only | mostly yes; `GOOGLE_API_KEY` plain env | ⚠️ | MEDIUM | move to Secret Manager (later) |
| RLS | enabled, 47 revokes client UPDATE | unverified | ❓ | – | owner script Q7 |
| storage ownership | path under own student folder | files service enforces; DB guard does not (N3) | ⚠️ | MEDIUM | N3 proposal (later) |
| logging / monitoring | alerts for worker/reaper failures | 26 alert policies (P1/P2 on uptime, 5xx, DB, jobs, AI provider); none for transcription queue/worker; default log sinks only | ⚠️ | ok | add Step 6 alerts at rollout |

## Part 15 — Final classification

**A — Old synchronous architecture.** The Step 6 database columns are present but dormant.

Evidence:
1. The live website (`main` `ee0143c`) has no enqueue call, no async UI and no flag. It calls `/transcribe` then `voice-score` directly.
2. Production functions (38 loaded) have no `transcription-enqueue`.
3. There is no production Cloud Tasks queue, no production transcription worker and no production reaper scheduler.
4. The database has the Step 6 columns (41–45). The old app never uses them (the default `transcription_status = completed`).

Not **C/D/E**, because no new backend component is running on production. The only doubt is the database function bodies, which does not change the classification.

## NEXT SAFE PRODUCTION STEP

The owner runs `docs/STEP6-PRODUCTION-READONLY-AUDIT-owner-studio.sql`, which is read-only and ends in ROLLBACK:
1. Open it in **Cloud SQL Studio** on `prooflab-db` / `prooflab`.
2. Confirm Q0 shows `transaction_read_only = on`.
3. Send back the output.

This settles Parts 3–6 and 13, above all which Migration 45 is live (Q9).

*(Not executed.)*
