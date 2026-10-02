# Cloud infrastructure, IAM, cost and capacity map (3 Oct 2026)

Read-only. **CFG**: all `gcloud … list/describe/get-iam-policy` reads on 3 Oct. No configuration was changed.

## 1. Cloud Run services (production + staging)

Production: see `CURRENT-FULL-SYSTEM-ARCHITECTURE` §2. Staging (CFG):

| Service | Revision | Image | Service account | Max × concurrency | Notes |
|---|---|---|---|---|---|
| prooflab-staging-api | 00002-rgj | postgrest:v16.3 | staging-api | 2 × 80 | staging DB |
| prooflab-staging-functions | 00032-pqn | functions@b101fcdc (**same image as prod**) | staging-functions | 2 × 80 | reads the **prod `deepseek-api-key`** and `github-pat` |
| prooflab-staging-auth-bridge | 00002-72n | same image as prod | staging-auth-bridge | 2 × 80 | |
| prooflab-staging-files | 00004-27l | files:v-no-vercel | staging-files | 2 × 80 | |
| prooflab-staging-accounts | 00004-m7r | accounts:v2 | staging-accounts (logWriter only, G06) | 2 × 80 | cannot manage logins (by design) |
| prooflab-staging-code-runner | 00002-8bg | code-runner:v1 | staging-code-runner | 2 × 1 | |
| prooflab-staging-transcriber | 00002-dg8 | transcriber:v1 | staging-transcriber | 2 × 1 | |
| prooflab-staging-transcription-worker | 00017-dw6 | worker:g1w | staging-transc-wk | 2 × **2** | |
| prooflab-staging-tasks-test-worker | 00001-58j | tasks-test-worker:v1 | staging-tasks-worker | 2 × 10 | **leftover test service** |

**Scale to zero:** every service, production and staging, has min instances 0.
- Cold starts on first request: Whisper loads the model at start (INFERRED: the slowest).
- Baseline cost is close to zero except Cloud SQL.
- Bursts are absorbed by max instances.

## 2. IAM (CFG today)

**Project-level roles:**

| Principal | Roles |
|---|---|
| user deploy.openfloor, user vidyuthsetu | owner |
| 135298577404-compute (default compute / Cloud Build) | artifactregistry.writer, cloudbuild.builds.builder, cloudsql.client, logging.logWriter, storage.objectViewer |
| github-deploy | firebasehosting.admin, serviceusage.serviceUsageConsumer |
| prooflab-rt-accounts | identitytoolkit.admin, logging.logWriter |
| prooflab-rt-api / staging-api | cloudsql.client, logging.logWriter |
| all other rt-* and staging-* robots | logging.logWriter only |
| firebase-adminsdk-fbsvc | firebase.sdkAdminServiceAgent, iam.serviceAccountTokenCreator (G08 accepted) |

**No `roles/editor` anywhere** (G05 holds).

**Per-secret readers (CFG):**

| Secret | Readers |
|---|---|
| prooflab-jwt-secret | **compute SA** + rt-accounts, rt-api, rt-authbridge, rt-bugfinder, rt-crawler, rt-files, rt-functions, rt-transcriber, transc-wk (**10 total**) |
| prooflab-db-uri | compute SA, rt-api |
| prooflab-db-password | compute SA |
| deepseek-api-key | compute SA, rt-functions, **staging-functions** |
| github-pat | compute SA, rt-crawler, rt-functions, **staging-functions** |
| resend-api-key | compute SA, rt-functions |
| webhook-secret | compute SA, rt-accounts, rt-functions |
| code-runner-secret | compute SA, code-runner, rt-functions |
| smoke / admin / college passwords | compute SA, rt-bugfinder |
| prooflab-testusers-password | compute SA |
| staging secrets | staging robots only |

Secrets **with no reader** (orphans):
- prooflab-company-test-password
- prooflab-db-postgres-password
- prooflab-e2e-password
- prooflab-recruiter-password
- prooflab-startup-password
- prooflab-student-password
- staging admin / college / recruiter / student passwords

**Blast radius:**
- The compute SA, which is used by Cloud Build and by no runtime, can read **every** production secret and holds objectAdmin on both buckets (N14 / G35). Anyone who can run a Cloud Build in the project gets everything.
- `prooflab-jwt-secret` = full DB (F1).
- `webhook-secret` = scheduled jobs plus a **password-reset link for any account** (N25).

## 3. Scheduler, queues, jobs

See `SYNC-ASYNC-JOB-QUEUE-MATRIX` §2–3.

## 4. Cloud SQL and connection architecture (CFG)

| Item | Production | Staging |
|---|---|---|
| Instance | prooflab-db, POSTGRES_17, db-g1-small (shared core, about 1.7 GB RAM), ZONAL asia-south1-c | prooflab-staging-db, db-f1-micro |
| Disk | 20 GB PD_SSD, auto-resize on | 10 GB |
| Backups | daily, 7 retained, **PITR on**, 7 days of logs | daily, 7 retained, PITR not shown |
| Maintenance | Sunday 21:00 UTC (Monday 02:30 IST) | — |
| Deletion protection | on | — |
| Network | public IPv4 on, `requireSsl=false`, IAM auth flag on; only the Cloud SQL connector from `prooflab-api` | same |
| `max_connections` | 50 (G01 audit, EARLIER) | — |
| Who connects | **only PostgREST** (pool 4 × max 4 instances = **16**). Every other service goes through PostgREST | |
| Exhaustion behaviour | requests wait in the PostgREST pool, then the 30 s API timeout returns 504 (INFERRED) | |

## 5. Storage (CFG)

| Bucket | Content | Lifecycle |
|---|---|---|
| prooflab-private-508214 | books 1, proofs 1, resumes 65, voice-explanations 32 (EARLIER count 3 Oct) | **none** (versioning on, 7-day soft delete: EARLIER) |
| prooflab-public-508214 | profile photos | none |
| prooflab-backups-508214 | SQL exports | none |
| staging private / public | staging | none |
| prooflab_logo, `_cloudbuild`, `run-sources-…` | build/brand artefacts | none |

## 6. Monitoring (CFG today)

**27 alert policies, all enabled:**
- 20 at P1: scheduled job failed, AI provider failing, bug finder broken step, daily tasks not created, DB CPU/connections/disk/down/memory, 8 down-checks, 5xx, Sunday scoring, voice/code 5xx.
- 7 at P2: container CPU/memory, login rejections, slow p95, crawler failed, voice/code busy, voice queue backlog.

**8 uptime checks:** site, API, functions `/ready`, bridge, files, accounts, code runner, voice.

**Blind spots:**
- no "AI usage not recorded" or "rate limiter not writing" alert (F3 went unseen for 3 weeks);
- no mass-student-removal alert (F6);
- no "crawler stored 0 new pages for N weeks";
- no "deep bug-finder trigger failing" (code 7 went unnoticed);
- no worker-specific alert beyond the queue backlog;
- no security alert on server-side events (none are written);
- bug-finder alerts are noisy while test logins are missing (N1).

Budget: ₹3,000/month, alerts at 50/80/100% (DOC/EARLIER).

## 7. Cost drivers (no invented numbers; billing export not read: U5)

| Driver | Behaviour | Evidence |
|---|---|---|
| Cloud SQL (2 instances, always on) | fixed monthly; the main fixed cost | CFG |
| Cloud Run | per request, scale to zero; Whisper (2 vCPU) and runner (2 vCPU) are the heavy ones | CFG |
| DeepSeek | per token; **unmeasured since 11 Sep** (F3); the largest variable driver (INFERRED) | DATA |
| Code runner / public runners | own compute / free external | SRC |
| Cloud Tasks | negligible at this volume (INFERRED) | — |
| Storage | small; grows with orphans (N2), no lifecycle | CFG |
| Egress | small (INFERRED) | — |
| Crawler | weekly 1 CPU job, about minutes | CFG |
| Bug finder | 5 runs/day × 2 CPU; deep run currently not running (code 7) | CFG |

**Expensive patterns:**
- unlimited written resubmits (1–2 AI calls each);
- per-student resume question generation (by design);
- lot-writer worst case of 7 calls per page;
- no AI timeouts (requests held, instance time billed);
- no working per-user cap (F3).

Lots are NOT generated per student (template reuse confirmed).

## 8. Capacity and 15,000-student target (INFERRED from config + EARLIER staging load; nothing proven on production)

**Registered students vs concurrent heavy actions:** 15,000 registered might mean about 1,500 daily-active, and perhaps about 150 concurrent at peak (planning assumption, not data).

| Layer | First stress point | Why |
|---|---|---|
| DB connections | **16 pooled connections** | all traffic funnels through PostgREST 4 × 4 |
| Daily Lot job | **single 540 s call for all colleges** | `assign_todays_lots` loops every active student in one transaction-ish call (F21) |
| Recruiter search | `recruiter_talent` per-candidate subqueries | U6; slow at 1k–10k |
| Code runner | 6 × 1 instances | a Submit of N tests = N runs; overflow goes to public runners |
| Voice | queue 2 concurrent + transcriber 3 × 1 | backlog grows linearly (about 13/min) |
| DeepSeek | no timeout, no cap | spikes hold functions instances (4 × 80) |
| Functions | 4 instances × 80 | AI waits occupy slots |
| Frontend | Firebase Hosting CDN | not a bottleneck |
| Scheduler | per-minute reaper fine | — |
| Storage | fine | — |

**EARLIER evidence (staging, about half size):**

| Test | Result |
|---|---|
| Browse 10 / 25 / 50 | p95 0.5 / 0.49 / 1.2 s |
| Browse 100 | 3.3 s |
| Browse 200 | 5.2 s, 0.3% errors |
| Run ×40 | 0.74 s p95 |
| Voice ×10 | 45 s |

**Not tested:** production, logins, written-grading load, TPO dashboards, recruiter search, imports, nightly jobs at scale.

**Status: 15k is NOT demonstrated.**

## 9. Infrastructure as code (F18)

| Defined as | Items |
|---|---|
| Code | `scripts/setup_monitoring.py` (alerts, uptime), `scripts/deploy-hosting.py`, Dockerfiles, `functions-service/cloudbuild.yaml`, `bug-finder/cloudbuild.yaml` |
| Runbook only | Cloud Run deploy commands, scheduler create commands, IAM grants (`docs/closure/OWNER-COMMANDS.md`, Step 6 runbook) |
| Console only | Cloud Run service settings, scheduler jobs, queues, buckets and IAM, secrets, Cloud SQL settings, Identity Platform settings |

**Drift seen today:**
- the leftover staging job, queue and test worker;
- prod worker max instances unset;
- orphan secrets.
