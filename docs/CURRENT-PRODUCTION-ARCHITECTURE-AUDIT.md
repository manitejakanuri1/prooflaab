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

## 4. The 20-vCPU quota (corrected 4 Oct, evening)

| | Value | Tag |
|---|---|---|
| Quota | `CpuAllocPerProjectRegion`, asia-south1 = **20,000 milli-vCPU** | MEASURED (Cloud Quotas API) |
| Shared by | production and staging | MEASURED |
| **Current measurement** (idle, 4 Oct ~12:00 UTC, no test running) | staging **3**, production **11**, total **14 of 20**, so **about 6 vCPU free** | MEASURED (Cloud Monitoring, instance count × vCPU) |
| Historical range, production idle / warm | **9–11 vCPU** all day 4 Oct | MEASURED |
| Historical range, staging after tests | 8–13 vCPU while test instances were still warm; 3 at rest | MEASURED |
| Peak quota exhaustion | total reached **20 of 20 five times on 4 Oct**, every time **during or just after staging tests** (instances from the test still warm) | MEASURED; staging logs "no available instance", "exceeded its quota limit for run.googleapis.com/cpu_allocation" |
| Production impact during those peaks | 0 × 5xx / 429 / start failures | MEASURED (production logs) |

The quota is **not** full at rest. It filled up only while staging test instances were still running.

Why instances stay warm:
- **Production.** 8 uptime checks run every 60 s, one per service. Cloud Run keeps an instance after a request for a while, so every checked service always has about 1 warm instance: api, functions, auth-bridge, accounts and files hold 1 vCPU each; code-runner and transcriber hold 2 each. That is 9 vCPU (INFERRED from the 60 s period and the constant one-instance count; MEASURED instance counts).
  - The production transcriber sometimes holds 2 instances (4 vCPU), which gives 11.
  - The uptime checks therefore **hold about 9 of the 20 vCPU at all times**.
  - This is the price of fast, cold-start-free production. It cuts the shared headroom to about 9–11 vCPU for everything else.
- **Staging** (MEASURED 3 vCPU at rest). Its every-minute `transcription-reap` keeps functions warm, and functions calls keep api and auth-bridge warm.

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

What this means (CODE + MEASURED):
- **Adding functions, runner, transcriber or worker instances never adds database connections.** Only API instances do.
- Production worst case: 4 API instances × 4 = **16** of about 50. Staging: 2 × 2 = **4** of 25.
- **Raising API max instances would not exhaust connections** until about 10 instances (10 × 4 = 40, the existing alert threshold).
- At 1,000 nonstop browsers on staging, requests queued for one of 4 pooled connections (server p95 10.4 s) while database CPU stayed under 40% (MEASURED, `CONCURRENCY-2000-REPORT.md` §8). This is one data point, on staging.
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

### Database conclusion, kept separate (corrected)

**DATABASE ARCHITECTURE: likely reasonable / needs further measurement.**

| Question | What is known | Tag | Still open |
|---|---|---|---|
| Database server capacity | Staging: CPU ≤ 40% at the heaviest read burst. Production: db-g1-small, CPU about 13%, memory 43% at today's light load | MEASURED (Monitoring) | Production under real load never measured |
| API connection-pool capacity | 4 connections per API instance (prod), 2 (staging). Staging queued at about 1,000 nonstop browsers | MEASURED (staging) | Production pool limit not measured |
| Query performance | Individual screen queries within limits (gate: 27/27 at 15,000 synthetic students) | MEASURED (staging) | No per-query statistics on staging (`pg_stat_statements` absent); production Query Insights not reviewed yet |
| Memory pressure | **Staging 100%** (db-f1-micro, 614 MB) → unstable timings (daily Lots 48 s vs 243 s, same data). Production 43% | MEASURED | — |
| Locking | 0 deadlocks (staging lifetime counter). Lock waits never sampled under load | MEASURED / UNVERIFIED | Lock waits under load |
| Connection pressure | Staging max 25 (MEASURED); at most 4 from PostgREST + 2 Cloud SQL agent + 1 job. Production max **50 is INFERRED** (tier default; no override flag: MEASURED) | MEASURED / INFERRED | Production value not read |
| Statement timeout | `statement_timeout = 0` on staging | MEASURED (staging) | Production UNVERIFIED |

What can be checked on production without changing it:
- Cloud SQL **settings and flags** (`gcloud sql instances describe`, already read: no `max_connections` override).
- **Monitoring metrics** (connections, CPU, memory, already read).
- **Query Insights** in the console (read-only).

Reading `max_connections` / `statement_timeout` directly needs a SQL session on production. That is read-only, but still a session on the production database, so **OWNER DECISION REQUIRED**.

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
| Cloud Run horizontal scaling | 🟡 | Stateless design scales (CODE). About 6 vCPU of the shared quota was free at the last idle measurement; it filled up during tests |
| Stateless app design | ✅ | No service keeps user state in memory; leases and claims live in Postgres |
| Load distribution | ✅ | Cloud Run front end |
| Database connection strategy | 🟡 | Single pooled path (CODE). Pool size was the first measured read limit on staging; `statement_timeout = 0`. Needs further measurement |
| Async background processing | ✅ | Cloud Tasks + leases + reaper; nothing lost in any test |
| Voice queue architecture | 🟡 | The queue sends 2 at a time while the transcriber takes 1 per instance. Under quota pressure only 1 instance runs → 429 → backoff collapse (measured 4.4 recordings/min) |
| Code runner isolation | ✅ | No network, scrubbed environment, time and memory limits, private IAM (staging) |
| Retry / idempotency | ✅ | Unique pass per task, idempotency keys, scoring leases, immutable scores |
| Service-to-service IAM | ❌ prod / 🟡 staging | **Production code-runner and transcriber, and the staging transcriber, are publicly invokable (`allUsers`)**; only an app-level secret or ticket protects them (§11) |
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

## 10. Is the architecture horizontally scalable? (component by component)

Key: ✅ scales out now · 🟡 scales but limited by configuration / quota · ❌ design limit · ⚪ external · 🔵 future concern only.

| Component | Current design | How it scales | Current limit | Kind of limit | Smallest fix if needed |
|---|---|---|---|---|---|
| Frontend / CDN | static files on Firebase | CDN | none seen | — | — ✅ |
| Auth bridge | stateless, signs tickets | more instances | max 3 (prod) / 2 (staging); sign-in under load never tested | configuration; UNVERIFIED | load-test ticket exchange 🟡 |
| API (PostgREST) | stateless; DB pool per instance | more instances (each adds pool connections) | staging 2 instances × pool 2 → 429 at about 1,000 nonstop browsers | configuration (max instances, pool) + quota | raise pool / instances within DB connection room 🟡 |
| Functions | stateless; AI calls hold a request slot | more instances, 80 requests each | max 4 / 2; not reached in tests | configuration + quota | — 🟡 |
| Code runner | one job per instance | more instances | 200 simultaneous Runs < 8 s on 2 instances; Submit runs tests one after another | configuration (max 6 / 2) + quota | — 🟡 |
| Files | stateless → Cloud Storage | more instances | 100 uploads at once fine | — | — ✅ |
| Cloud Tasks | managed queue | managed | **2 dispatches at a time** (setting) | configuration | experiment C (pending) 🟡 |
| Transcription worker | stateless, leases in DB | more instances | production max **unset (100)** | configuration (unbounded) | set a maximum 🟡 |
| Transcriber (Whisper) | CPU-heavy, one recording per instance | more instances, 2 vCPU each | about 18 recordings/min on 1 instance; 2nd instance blocked by quota | **quota + configuration** | experiments B/C, or more quota 🟡 |
| Voice scoring | functions + DeepSeek | with functions | 1 connection reset in 250 → unscored, not retried | external + design gap (no automatic retry of transient AI failure) | fallback keys on staging; retry transient failure ⚪ / 🟡 |
| AI providers | DeepSeek → Gemini → Kimi | provider side | rate limits not reached in tests | external | — ⚪ |
| Scheduler / jobs | batched, resumable | batches of 250, continue on retry | staging DB speed | staging-only | — ✅ |
| PostgreSQL | one zonal Cloud SQL instance | **vertical only** (bigger tier) | prod 1.7 GB, CPU about 13% today; staging 614 MB at 100% memory | size at current scale (not design) | bigger tier when measured 🔵 (sharding not needed: 264 MB) |
| DB connection pool | inside PostgREST | grows with API instances | 4 per instance | configuration | raise pool within `max_connections` 🟡 |
| Storage | Cloud Storage | managed | none | — | — ✅ |

**Verdict: PARTIALLY.**
- **The architecture can scale.** Every request-serving part is stateless, uses queues with leases, and talks to one pooled database path. No measured limit is a design flaw.
- Two small design gaps: transient AI failures are not retried automatically, and the database only scales up, not out. The second is a future concern at 264 MB.
- **The current deployment cannot scale further** because of configuration (max instances, pool sizes, queue concurrency) and the **shared 20-vCPU quota**.
- Reaching 2,000 concurrent students *appears* achievable by tuning and quota, **not proven**. Voice throughput is the first thing to prove: about 18 recordings/min per transcriber instance is MEASURED; the number of instances 2,000 students need is arithmetic, INFERRED.

## 11. Exposure of the private services (MEASURED: live IAM + probes, 4 Oct)

| Service | Ingress | Invoker (IAM) | No credential at all | Valid student ProofLab ticket | Publicly invokable | Internal only | Safe |
|---|---|---|---|---|---|---|---|
| prooflab-code-runner (prod) | all | **allUsers** | 401 `unauthorized` (app checks `x-runner-secret`) | refused: only the shared secret is checked (CODE; not probed on prod) | **YES** | NO | **Partly.** One shared secret; anyone can reach it and try |
| prooflab-transcriber (prod) | all | **allUsers** | 401 | **accepted** (CODE: any valid user ticket; legacy browser path `src/lib/transcribeAudio.ts`) | **YES** | NO | **Partly.** Writes nothing, but any student can occupy it with their own audio (quota / cost abuse) |
| prooflab-transcription-worker (prod) | all | prooflab-tasks-invoker only | 403 (Google front end) | not probed on prod | NO | YES | YES |
| prooflab-staging-code-runner | all | staging functions SA only | 403 | 401 | NO | YES | YES |
| prooflab-staging-transcriber | all | **allUsers** | 401 | **accepted** (413 only because the probe body was empty) | **YES** | NO | Partly (same as prod) |
| prooflab-staging-transcription-worker | all | staging tasks-invoker only | 403 | 401 | NO | YES | YES |

`ingress=all` with an IAM-only invoker is still private: Google's front end refuses anyone without the invoker role. The `allUsers` services are the exception. Rollout stage 6.3 already plans the runner change; the transcriber needs the same decision. **No IAM was changed.**

## 12. The table without row-level security (MEASURED on staging)

- **Table:** `public.skill_aliases (alias text primary key, skill text)`, about 50 rows mapping resume wording to skills (migration 30). No student, company or private data.
- **Grants on staging:** `anon`, `authenticated`, `service_role` and `postgres` have **SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER**. Migration 31 granted only SELECT; the rest must come from default privileges (INFERRED).
- **Proven on staging:**
  - An **anonymous** request (no login) and a student request each **inserted** a row through the API (HTTP 201).
  - Both marker rows were deleted straight after; 0 left.
- **Production:** anonymous **read** works (HTTP 200). Writes were **not** attempted. Exposure is **UNVERIFIED, likely** (same default privileges).
- **Risk:** anyone on the internet could change or empty the alias list. That would quietly change resume skill matching (integrity, not privacy).
- **Verdict: NEEDS CHANGE.** Revoke INSERT / UPDATE / DELETE / TRUNCATE from `anon` and `authenticated` (keep SELECT), or enable RLS with a read-only policy. Not applied.

## 9. Open questions this audit could not settle without changes

1. **Production `max_connections` / `statement_timeout`.** 50 INFERRED from the tier default; reading them needs a read-only SQL session on production (OWNER DECISION REQUIRED).
2. **Staging slow queries.** Needs `pg_stat_statements` on staging (a staging database flag change). Proposed, not applied.
3. **Real application limits.** With about 6 vCPU free at rest, staging tests reach the shared quota quickly, so several limits measured so far are quota limits, not application limits.
4. **Production write exposure of `skill_aliases`.** UNVERIFIED (no write test on production).
