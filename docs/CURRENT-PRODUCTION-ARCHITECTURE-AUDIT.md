# Current production architecture audit

4 Oct 2026, commit `a392767`. Read from the live Google Cloud project `prooflab-508214` (region `asia-south1`), the code and the migrations. Not taken from older documents. Nothing was changed while reading.

Labels used: **MEASURED** (read or tested today), **CODE** (read from source), **INFERRED** (reasoned, not measured).

---

## 1. The whole system in one picture

```
STUDENT browser (React app on Firebase Hosting, prooflab.co.in)
   │  1. Google sign-in (Identity Platform)
   ▼
AUTH BRIDGE (prooflab-auth-bridge)  ── swaps the Google token for a ProofLab ticket
   │  2. every request carries the ticket
   ├──────────────► API (prooflab-api = PostgREST 16.3) ──► Cloud SQL Postgres 17 (prooflab-db)
   │                  ▲ the ONLY service that opens database connections
   ├──────────────► FUNCTIONS (prooflab-functions, 32 Deno functions) ── HTTP ──► API
   │                    ├── AI: DeepSeek → Gemini → Kimi (external)
   │                    └── CODE RUNNER (private) for Run / Submit
   └──────────────► FILES (prooflab-files) ──► private Cloud Storage bucket (voice audio)

Background:
 Cloud Scheduler ──► FUNCTIONS /scheduled-job (daily Lots, squads, seasons, …)
 Cloud Scheduler ──► FUNCTIONS /transcription-reap (every minute)
 Cloud Tasks queue ──► TRANSCRIPTION WORKER (private) ──► TRANSCRIBER (Whisper) ──► FUNCTIONS voice-score
 Cloud Scheduler ──► ACCOUNTS /sync (every 10 min)   ── HTTP ──► API
 Cloud Scheduler ──► Cloud Run Jobs: crawler (weekly), bug-finder (5×/day + deep daily)
```

## 2. Request flows

### Normal page (Floor, Build-log, Squad, Profile)
Student → browser → (ticket) → **API** (PostgREST) → Postgres with row-level security as role `authenticated` → answer.
- One HTTP call per list or RPC.
- No function is involved.
- 82 of 83 public tables have row-level security on (MEASURED on staging).

### Coding
Student → **functions** `run-sandbox` (Run) or `submit-sandbox-task` (Submit):
1. Checks the ticket.
2. Rate limit is counted in Postgres through the API.
3. Reads the task and the test set with the service key, through the API.
4. **Code runner** (private, called with the functions service account's Google identity), **once per test, one after another**.
5. Grade is computed in functions.
6. `record_task_submission()` through the API.
7. Result is stored in `task_submissions`.

Run uses only visible tests and stores nothing.

### Voice
1. Student → **files** (PUT audio into the private bucket, write-once).
2. → **functions** `transcription-enqueue`: checks owner and submission, inserts a `voice_explanations` row bound to the submission, puts a job on Cloud Tasks.
3. Queue → **transcription worker** (private), which claims a lease.
4. → **transcriber** (Whisper, language check).
5. Transcript saved through the API.
6. → **functions** `voice-score` (DeepSeek) → `voice_explanations` scored.
7. Every minute `transcription-reap` re-queues anything stuck.

### Daily Lots
Cloud Scheduler 05:40 IST (identity token) → **functions** `/scheduled-job?job=daily-lots` → loops `assign_todays_lots_batch` through the API, **250 students per call**, 240 s budget.
- Returns 500 (Scheduler retries) on failure or on running out of time.
- A retry continues where the last run stopped.

### TPO / Company / Admin
Browser → **API** RPCs only:
- TPO: `tpo_students`, `tpo_student_profile`, squads, insights.
- Company: `recruiter_talent`, `recruiter_proof_profile`, `company_submissions`.
- Admin: admin lists, ops health.

Each RPC checks the caller's role inside the database (security definer + role check). Company Lot creation and student import go through **functions** (`company-lot`, `create-student-users`).

## 3. Every component (production; staging differences in brackets)

| Component | Does | vCPU | Memory | Min | Max | Requests per instance | Timeout | DB access | Retry / queue | On failure | Auth | Stateless | Scales out | Uses the 20-vCPU quota |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Frontend | React app | — | — | — | — | — | — | none | — | — | — | yes | Firebase CDN | **no** |
| auth-bridge | Google token → ProofLab ticket; service tickets | 1 | 256 Mi | 0 | 3 [2] | 80 | default 300 s | none (signs tickets) | none | 401 | Identity Platform token in, signed ticket out | yes | yes | yes |
| api (PostgREST 16.3) | All data reads / writes, RPCs | 1 | 512 Mi | 0 | 4 [2] | 80 | **30 s** | **pool `PGRST_DB_POOL` = 4 [2] per instance**, Cloud SQL connector | none | 5xx / 504 at 30 s | ticket (RS256 on staging; HS256 shared secret on production until stage 6) | yes | yes; each instance adds pool connections | yes |
| functions (Deno, 32) | AI, grading, enqueue, scheduled jobs | 1 | 1 Gi | 0 | 4 [2] | 80 | 300 s | **none direct**, all via API over HTTP | AI: per-provider retry on 429 / 503, then the next provider; 90 s per call | safe error, never a fake score (`EVALUATION-ENGINE-AUDIT.md`) | ticket; Scheduler by secret (prod) / identity (staging) | yes | yes; AI waits hold request slots | yes |
| code-runner | Runs student code in a sandbox | **2** | 2 Gi | 0 | 6 [2] | **1** | 120 s | none | none (caller answers "busy") | 503 → "runner busy, nothing saved" | shared secret (prod) / IAM identity, private (staging) | yes | yes; **one test run at a time per instance** | yes, 2 vCPU each |
| transcriber | Whisper `base` int8 + language gate | **2** | 2 Gi | 0 | 3 [2] | **1** | 120 s | none | none | 429 when busy | private | yes | yes; one recording at a time per instance | yes, 2 vCPU each |
| transcription-worker | Takes queue jobs, leases, calls transcriber and scoring | 1 | 512 Mi | 0 | **unset (default 100)** [2] | 80 [2] | 300 s | via API | Cloud Tasks: **3 attempts, 5–30 s** [8, 10–120 s]; lease + reaper | 500 → queue retry; terminal on 4xx | Cloud Tasks identity | yes | yes | yes |
| Cloud Tasks queue | Voice jobs | — | — | — | — | **2 at a time**, 1/s | — | — | see worker | — | — | — | — | no |
| files | Upload / read audio and files | 1 | 512 Mi | 0 | 4 [2] | 80 | default | via API (grants) | none | 4xx / 5xx | ticket + file grant | yes | yes | yes |
| accounts | Login-pool sync every 10 min | 1 | 512 Mi | 0 | 2 | 80 | default | via API | Scheduler | alert | Scheduler | yes | yes | yes |
| crawler job | Weekly page crawl → Lot templates | 1 | 1 Gi | — | 1 task | — | job | via API | 1 retry | alert | own account | — | — | yes, while running |
| bug-finder job | Robot journeys 5×/day | **2** [1] | 2 Gi | — | 1 | — | job | via API | 0 | alert | own account | — | — | yes, while running |
| Cloud SQL `prooflab-db` | Postgres 17 | shared core | **1.7 GB** (db-g1-small) | — | — | — | `statement_timeout = 0` | **max 50 connections** (Cloud SQL default for this tier; INFERRED, not read on production) | — | — | IAM auth flag on | **stateful** | **no** (one zonal instance) | no |
| [staging DB `prooflab-staging-db`] | | shared core | **614 MB** (db-f1-micro), memory 100% | | | | `statement_timeout = 0` | **max 25** (MEASURED) | | | | stateful | no | no |
| Cloud Scheduler | 12 production jobs (§5) | — | — | — | — | — | — | — | Scheduler retries | `[P1] A scheduled job failed` | secret header (prod) | — | — | no |
| AI providers | DeepSeek (main), Gemini, Kimi | external | | | | | 90 s per call | — | fallback chain | `LlmUnavailableError` → safe error | API keys in Secret Manager | — | provider limits | no |

**CPU throttling.**
- Production `functions` and `transcriber` bill CPU only during requests. All other services use the default.
- Every instance that is running, including idle ones, counts toward the regional quota.

## 4. The 20-vCPU quota: measured

| | |
|---|---|
| Quota | `CpuAllocPerProjectRegion`, asia-south1 = **20,000 milli-vCPU** (MEASURED, Cloud Quotas API) |
| Shared by | production and staging |
| Production held at rest | **9 vCPU** (MEASURED all day). One warm instance each of api, functions, auth-bridge, accounts, files (1 each), code-runner (2) and transcriber (2) |
| Why production never goes to zero | **8 uptime checks every 60 s** hit each service, so one instance always stays warm (INFERRED from 60 s period + measured constant 1 instance) |
| Staging held | 8–13 vCPU after any test (MEASURED); falls as idle instances shut down (16 of 20 total was seen once) |
| Effect | When the total is at 20, **no service in either environment can start another instance**. Seen 5 times on 4 Oct, staging only: runner, transcriber and accounts could not start. Production showed no errors, because its warm instances were enough for its traffic |
| Production maximum it could ask for | api 4 + functions 4 + auth 3 + accounts 2 + files 4 + runner 12 + transcriber 6 + worker (unbounded) = **35+ vCPU**, already more than the quota |

## 5. Background jobs (production)

| Job | When (IST) | Target |
|---|---|---|
| transcription-reap | every minute | functions |
| accounts-sync | every 10 min | accounts |
| bug-finder | 06, 10, 14, 18, 22 h | Cloud Run job (2 vCPU while running) |
| bug-finder deep | 04:00 | Cloud Run job |
| prune-events | 03:10 | functions |
| nightly-squads | 05:35 | functions |
| extend-fixtures | 05:37 | functions |
| daily-lots | 05:40 | functions |
| weekly-seasons / -progress | Sun 23:30 / 23:45 | functions |
| weekly-plan | Mon 08:00 | functions |
| crawler | Sun 08:10 | Cloud Run job |

Staging has one job (transcription-reap). The other staging jobs are started by the tests.

## 6. Database: how every path reaches Postgres (Phase 2)

| Path | Mechanism | Connections |
|---|---|---|
| Browser reads / writes | PostgREST, its own pool, **session-style connections held by PostgREST**, role switched per request from the ticket | `PGRST_DB_POOL` per API instance: production **4**, staging **2** |
| Functions (grading, voice, enqueue, jobs) | **HTTP to PostgREST** with the service key (`service_role`, bypasses RLS) | none of their own. They reuse the API pool |
| Accounts, transcription worker, crawler, bug-finder | HTTP to PostgREST | none of their own |
| Migrations / inspection | Cloud Run job running `psql` (staging) / `gcloud sql import` (production) | 1 while running |
| Cloud SQL agent | — | 2 (MEASURED staging) |

What this means:
- **Adding functions, runner, transcriber or worker instances never adds database connections.** Only API instances do.
- Production worst case: 4 API instances × 4 = **16** of about 50. Staging: 2 × 2 = **4** of 25.
- **Raising API max instances would not exhaust connections** until about 10 instances (10 × 4 = 40, the existing alert threshold).
- **The real database-side limit today is the pool, not the server.** At 1,000 nonstop browsers on staging, requests queued for one of 4 connections (server p95 10.4 s) while database CPU stayed under 40% (MEASURED, `CONCURRENCY-2000-REPORT.md` §8).
- No transaction pooler (PgBouncer) and none needed at these numbers.

Staging database health (MEASURED today):

| | |
|---|---|
| Deadlocks | 0 |
| Cache hit | 99% |
| Temp files | 22 |
| Size | 264 MB; largest table `tasks` 128 MB, mostly the historical 15,000-student dataset |
| Memory | **at 100%** (db-f1-micro) → speed swings: the same job took 48 s once and 243 s later. **STAGING ENVIRONMENT LIMITATION**; production is db-g1-small (1.7 GB, memory 43%) |
| `statement_timeout` | **0** (no database-side limit). PostgREST ends at 30 s, but a slow query can keep running after the request is gone (INFERRED) |
| Slow-query statistics | `pg_stat_statements` is **not installed on staging**. Production has Query Insights on. Staging slow queries can only be seen indirectly |
| Roles | PostgREST logs in as `postgres` (not superuser, no RLS bypass) and switches to `anon` / `authenticated` / `service_role`. Only `service_role` bypasses RLS |
| Locks | none seen. Lock waits were not measurable without `pg_stat_statements` / `pg_locks` sampling during load |

## 7. Monitoring that exists (configuration, not yet proven to fire, see Phase 15)

- **Production:** 27 policies. 8 uptime checks; 5xx; slow p95 > 3 s; CPU / memory; database down / CPU / disk / memory / connections > 40; scheduled job failed; daily tasks not created; Sunday scoring; AI provider failing; voice / code busy; voice queue backlog; crawler; bug-finder.
- **Staging:** 15 `[STAGING]` policies. One of them, "Cloud Run could not start an instance", would have matched 5 times today; whether it emailed is to be checked.
- **Missing in production:**
  - "Cloud Run could not start an instance" (quota exhaustion). Exists only for staging.
  - Budget alert at ₹3,000/month: exists.
  - Recovery point / time objectives (RPO / RTO): **not defined anywhere: OWNER DECISION REQUIRED**.
- **Logging:** one JSON line per request with `request_id`, `session_id`, function and hashed user; `x-request-id` from the browser; `llm_usage.request_id` links AI calls.

## 8. First classification (Phase 3; updated after measurements)

| Area | Verdict | Why (evidence) |
|---|---|---|
| Cloud Run horizontal scaling | 🟡 | Design is stateless and scales, but the shared 20-vCPU quota is already full at rest |
| Stateless app design | ✅ | No service keeps user state in memory; leases and claims live in Postgres |
| Load distribution | ✅ | Cloud Run front end |
| Database connection strategy | ✅ / 🟡 | Single pooled path; tuning only: pool 4 per API instance is the read ceiling, `statement_timeout = 0` |
| Async background processing | ✅ | Cloud Tasks + leases + reaper; nothing lost in any test |
| Voice queue architecture | 🟡 | The queue sends 2 at a time while the transcriber takes 1 per instance. Under quota pressure only 1 instance runs → 429 → backoff collapse (measured 4.4 recordings/min) |
| Code runner isolation | ✅ | No network, scrubbed environment, time and memory limits, private IAM (staging) |
| Retry / idempotency | ✅ | Unique pass per task, idempotency keys, scoring leases, immutable scores |
| Service-to-service IAM | 🟡 | Done on staging. Production still uses a shared secret for Scheduler and runner until rollout stage 6 |
| Rate limiting | ✅ / 🟡 | Per-user limits work. Each limit check is an extra database write through the API (INFERRED cost at scale) |
| Timeouts | ✅ | API 30 s, AI 90 s per provider, runner 70 s client / 120 s server, Cloud Run timeouts set |
| Circuit breakers | ⚪ | Not implemented; provider fallback + timeouts cover it at this scale |
| AI provider fallback | 🟡 | Code supports DeepSeek → Gemini → Kimi. **Staging has no fallback keys**: one DeepSeek connection reset = one unscored recording |
| Caching | ⚪ | Only AI-answer cache (`llm_cache`). No evidence that reads need more |
| Read replicas | ⚪ | Database CPU < 40% at the read ceiling; the pool is the limit |
| Redis | ⚪ | No repeated expensive read measured |
| Sharding | ⚪ | 264 MB of data |
| Queue backpressure | 🟡 | See the voice queue |
| Monitoring / alerts | 🟡 | Many alerts, not yet proven to fire. Production lacks a quota / start-failure alert |
| Logging / correlation ids | ✅ | Request ids end to end |
| Backups | ✅ (config) | Daily, 7 kept, point-in-time recovery on in production. **Restore not rehearsed** |
| Migration rollback | 🟡 | Rollback files exist for each; never run on production data |
| Disaster recovery | ❌ | No RPO / RTO; restore never rehearsed; single-zone database |

## 9. Open questions this audit could not settle without changes

1. **Production `max_connections`.** Assumed 50 from the tier default; reading it needs a query on production (read-only). Not done.
2. **Staging slow queries.** Needs `pg_stat_statements` on staging (a staging database flag change). Proposed, not applied.
3. **Real application limits.** Every staging service above about 11 vCPU is blocked by the shared quota, so most component limits measured so far are quota limits, not application limits. See the separately proposed staging setting changes.
