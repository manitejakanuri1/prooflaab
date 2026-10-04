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
- **Verdict: NEEDS CHANGE.** Fixed on staging by migration 79 (§13.5); production pending.

## 9. Open questions this audit could not settle without changes

1. **Production `max_connections` / `statement_timeout`.** 50 INFERRED from the tier default; reading them needs a read-only SQL session on production (OWNER DECISION REQUIRED).
2. **Staging slow queries.** Needs `pg_stat_statements` on staging (a staging database flag change). Proposed, not applied.
3. **Real application limits.** With about 6 vCPU free at rest, staging tests reach the shared quota quickly, so several limits measured so far are quota limits, not application limits.
4. **Production write exposure of `skill_aliases`.** UNVERIFIED (no write test on production).

## 13. Security hardening, staging (4 Oct 2026, evening)

Starting commit `2c52125`. Production was not touched: no IAM, settings, database or deploy change. Re-checked: production `skill_aliases` anonymous read still answers 200, as before.

### 13.1 Who really calls the internal services (CODE + MEASURED)

| Service | Callers in code | How they authenticate | Allowed caller should be | Browser calls it directly? |
|---|---|---|---|---|
| code-runner | `supabase/functions/_shared/sandbox.ts` → `runOnOwnRunner` (functions: run-code, run-sandbox, submit-sandbox-task, resume-code-execute, the generators' quality gate) | prod: `x-runner-secret`; staging: the functions SA's Google identity token (`CODE_RUNNER_AUTH=iam`) | prod `prooflab-rt-functions@`, staging `prooflab-staging-functions@` | **No.** No frontend reference |
| transcriber | (1) `transcription-worker/server.py` `transcribe()`: a **ProofLab app ticket** (`mint_token("authenticated")`), not a Google identity. (2) **Browser:** `src/lib/transcribeAudio.ts`, used by **`MockInterview.tsx`** (always) and by `VoiceExplainModal.tsx` only when `VITE_ASYNC_TRANSCRIPTION` is not `true` | app ticket checked by `transcriber/apptoken.py` (any valid user ticket is accepted) | the worker SA (`prooflab-transc-wk@` / `prooflab-staging-transc-wk@`) and, today, students for the mock interview | **YES: current** for the mock interview (Profile → Mock interview). **Legacy** for voice explanations (both `.env.production` and `.env.staging` set `VITE_ASYNC_TRANSCRIPTION=true`) |
| transcription-worker | Cloud Tasks queue only | Cloud Tasks OIDC as `prooflab-tasks-invoker@` / `prooflab-staging-tasks-invoker@` | that tasks-invoker SA | No |

### 13.2 Staging transcriber: NOT changed (stop condition met)

- Removing `allUsers` would make the **mock interview** lose every transcript.
  - `transcribeAudio` would fail, and `MockInterview` saves `""` on failure, so each answer would read "(no speech captured)".
  - That breaks a current student flow without an error message.
- It would also stop the **worker**: it sends a ProofLab ticket in `Authorization`, not a Google identity token.
- So the private path needs code first. Proposed design (owner approval needed):

  1. **Mock interview** goes through the backend, like voice explanations.
     - The browser uploads the answer to **files**.
     - It then calls a new function `mock-interview-transcribe`, or the existing queue.
     - Functions call the transcriber with its Google identity.
  2. **Worker** sends a Google identity token for the transcriber audience. The runner already works this way (`identityTokenFor` / metadata server).
  3. **Transcriber** accepts only an allow-listed caller email (`TRANSCRIBER_ALLOWED_CALLERS`, same pattern as `RUNNER_ALLOWED_CALLERS`). The app-ticket path is kept only until the cutover.
  4. Delete the legacy sync path: `transcribeWithTimestamps` use in `VoiceExplainModal`, and `transcribeAudio.ts` once the mock interview has moved.
  5. Then IAM: remove `allUsers`; `run.invoker` = worker SA (+ functions SA if used for the mock interview).

  Expected after that:
  - no credential → 403 (Google front end);
  - student ticket → 401 / 403;
  - wrong SA → 403;
  - worker SA → 200.

### 13.3 Staging code runner: re-proved (MEASURED today)

| Check | Result |
|---|---|
| `allUsers` / `allAuthenticatedUsers` | absent; `run.invoker` = `prooflab-staging-functions@` only |
| No credential | 403 (Google front end) |
| Student ProofLab ticket | 401 |
| Wrong Google identity (staging scheduler SA) | 403 |
| Functions identity | accepted: Run 200 through functions (`staging_identity_check.py` 23/23) |
| Submit | passed 100; hidden tests returned as `id / visible / verdict / passed` only; no hidden expected output in the reply |
| Direct browser path | none in `src/` |

### 13.4 Production code-runner: proposal only (not applied)

| | |
|---|---|
| Current (MEASURED) | ingress all; `run.invoker` = **allUsers**; app check = `x-runner-secret` (functions env `CODE_RUNNER_SECRET`) |
| Target | `run.invoker` = `serviceAccount:prooflab-rt-functions@prooflab-508214.iam.gserviceaccount.com` only; runner env `RUNNER_ALLOWED_CALLERS=prooflab-rt-functions@…`; functions env `CODE_RUNNER_AUTH=iam`; no shared secret |
| Prerequisite | production runs this release's runner and functions images (rollout stage 3). Today's production images predate identity support (INFERRED from the release history; image not inspected) |
| Downtime | about 1–3 minutes of Run / Submit answering "runner busy, try again" (nothing saved, nothing lost), because the runner checks either the secret or the identity, not both. Zero-downtime option: a small runner change accepting both during the switch (not built) |

Commands, in order (after stage 3):
```
P=prooflab-508214; R=asia-south1; FN=prooflab-rt-functions@$P.iam.gserviceaccount.com
gcloud run services add-iam-policy-binding prooflab-code-runner --region=$R --project=$P --member=serviceAccount:$FN --role=roles/run.invoker
gcloud run services update prooflab-code-runner --region=$R --project=$P --update-env-vars=RUNNER_ALLOWED_CALLERS=$FN
gcloud run services update prooflab-functions --region=$R --project=$P --update-env-vars=CODE_RUNNER_AUTH=iam --remove-secrets=CODE_RUNNER_SECRET
# check: a student Run works on prooflab.co.in, then:
gcloud run services remove-iam-policy-binding prooflab-code-runner --region=$R --project=$P --member=allUsers --role=roles/run.invoker
gcloud run services update prooflab-code-runner --region=$R --project=$P --remove-secrets=CODE_RUNNER_SECRET   # only if mounted as a secret; else --remove-env-vars
```
Rollback:
```
gcloud run services add-iam-policy-binding prooflab-code-runner --region=$R --project=$P --member=allUsers --role=roles/run.invoker
gcloud run services update prooflab-code-runner --region=$R --project=$P --remove-env-vars=RUNNER_ALLOWED_CALLERS --update-secrets=CODE_RUNNER_SECRET=<secret name>:latest
gcloud run services update prooflab-functions --region=$R --project=$P --remove-env-vars=CODE_RUNNER_AUTH --update-secrets=CODE_RUNNER_SECRET=<secret name>:latest
```
(The secret's name is read from the current production revision before starting.)

Tests after the change:
1. No credential → 403.
2. Old secret header → 403.
3. Another SA → 403.
4. Run and Submit on the live site; `scripts/healthcheck.py`; `attack_surface_check.py`.

### 13.5 `skill_aliases`: fixed on staging (migration 79)

**Before** (MEASURED staging; `aclexplode`):
- `anon`, `authenticated`, `service_role`, `postgres` each had **SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN**. No PUBLIC entry.
- RLS off.
- Cause: the schema's **default privileges** (`pg_default_acl` for role `postgres` in `public`):
  - tables: `anon=arwdDxtm, authenticated=arwdDxtm, service_role=arwdDxtm`
  - sequences: `rwU`
  - functions: `X` (execute)
- So **every new table is fully open to anon unless RLS is turned on**. `skill_aliases` was the only table without RLS.
- Proven earlier: an anonymous request and a student request each inserted a row (HTTP 201; rows removed).

**Who needs it** (CODE): only `suggest_tracks()` (security definer, owner `postgres`). No frontend or server code reads the table directly. So app callers need **no** access, not even SELECT.

**Chosen fix (option A + RLS as a second guard):**
- Revoke everything from PUBLIC, `anon`, `authenticated`.
- `service_role` keeps SELECT only.
- RLS on with no policy (the owner and `suggest_tracks` are unaffected because RLS is not forced).
- Simpler and safer than option B: no policy to get wrong; nobody but the owner writes.
- Files: `migration/79-skill-aliases-read-only.sql` (self-check), mirror `supabase/migrations/20261103002900_skill_aliases_read_only.sql`, rollback `79-rollback-…` (restores the unsafe state; warned). Number 78 stays reserved for the coding-verification change.
- Applied to staging through the ledger: "LEDGER: 79-skill-aliases-read-only applied and recorded".

**After** (MEASURED staging):

| Caller | SELECT | INSERT | UPDATE | DELETE | TRUNCATE |
|---|---|---|---|---|---|
| anon, through the API | 401 | 401 | 401 | 401 | not exposed by the API; in SQL as `anon`: refused |
| student, through the API | 403 | 403 | 403 | 403 | in SQL as `authenticated`: refused |
| `service_role` | allowed (SELECT only) | refused | refused | refused | refused |

Regression, in a transaction rolled back afterwards:
- A student whose only skill is `py`, with alias `py → Python` present.
- `suggest_tracks` called **as that student** returns the Python track with `matched_steps = 3`, `matched_skills = {py}`.
- Afterwards: the student's skills and the alias table are unchanged (verified).
- No marker rows remain.

### 13.6 Read-only sweep of every Cloud Run service (MEASURED)

| Service | Ingress | run.invoker | Public by design? | Safe? |
|---|---|---|---|---|
| prooflab-api / staging-api | all | allUsers | **yes** (browser; RLS + ticket) | yes |
| prooflab-functions / staging-functions | all | allUsers | **yes** (browser; ticket checked per function) | yes |
| prooflab-auth-bridge / staging | all | allUsers | **yes** (sign-in) | yes |
| prooflab-files / staging | all | allUsers | **yes** (uploads; ticket + grant) | yes |
| prooflab-accounts / staging | all | allUsers | partly (Scheduler `/sync`; app check: no credential → 401 MEASURED) | yes (app-level) — LOW |
| **prooflab-code-runner** | all | **allUsers** | no | **HIGH**: app secret only |
| **prooflab-transcriber / staging-transcriber** | all | **allUsers** | no (mock interview uses it from the browser today) | **MEDIUM**: no data exposure; any student can use CPU |
| staging-code-runner | all | staging functions SA | no | yes |
| (staging-)transcription-worker, staging-tasks-test-worker | all | tasks-invoker SA | no | yes |

No service grants `allAuthenticatedUsers`.

### 13.7 New database findings (not fixed; need approval)

| # | Finding (MEASURED) | Severity | Note |
|---|---|---|---|
| D1 | **Staging only:** 22 server-only functions are executable by `anon` and `authenticated`, including `record_task_submission` (writes a grade; **no caller check inside**), `touch_streak`, `create_lot_for`, `run_all_seasons`, `form_all_colleges`, `prune_app_events`, `account_id_for_email` (anonymous call returned the admin's account id). The migrations revoke these (stage 69/70, migration 04), so **staging's permissions drifted from its migrations** | **CRITICAL on staging** (any visitor could write a passed grade there); it also means earlier staging security evidence did not cover direct RPC calls to these functions | production refused both functions probed (`account_id_for_email`, `similar_written_submission`: 401 permission denied). The other 20 are **UNVERIFIED on production** without a read-only SQL session |
| D2 | Default privileges give `anon` / `authenticated` all table rights, sequence use and function execute on every **new** object in `public` | **HIGH** (systemic): one forgotten `enable row level security` or `revoke` reopens it | fix: `alter default privileges … revoke … from anon, authenticated` and grant explicitly per object |
| D3 | View `admin_users` has no `security_invoker` and `anon` can SELECT it | LOW (MEASURED: returns `[]` to anon and a student; it filters internally) | add `security_invoker` |
| D4 | 171 security-definer functions executable by `anon` on staging; most check the caller inside (e.g. `admin_users_write` checks `is_admin()`) | needs a per-function review | the `attack_surface_check.py` / `authz_matrix_check.py` coverage should include direct RPC calls |

## 14. D1: server-only database functions (staging, 4 Oct 2026)

Starting commit `68162b3`. Fix commit `2b9c9a5`. Staging only. Production database and IAM untouched.

### Before (MEASURED, staging)
- 26 function signatures that only servers call were executable by **PUBLIC, `anon` and `authenticated`** through the API. They had no ACL of their own, so Postgres's default (PUBLIC may execute) applied.
- One of them, `record_task_submission`, writes a grade, completes the task and pays XP, and has **no caller check inside** (CODE). A student could have written themselves a passed 100.
- An anonymous call to `account_id_for_email` returned a real account id.
- The release gate passed 31/31 meanwhile: no step called these functions directly.

### Root cause
- The migrations that create these functions revoke them (stage 31, 55, 69/70, 70b, 88, `service_role_function_grants`, `remove_students`, …), but the staging database's privileges did not match.
- The functions carry no ACL at all, so the revokes either never ran there or the functions were recreated later without them. How staging was originally built is not recorded: **INFERRED**.
- Production refused the two functions probed earlier (401 permission denied). The rest are **UNVERIFIED on production**.

### How the 26 were chosen (`scripts/dev-tools/rpc_caller_audit.py`, CODE + MEASURED)
- A function is **server-only** when:
  - no browser code calls it (`supabase.rpc(...)` under `src/`);
  - a server calls it with the service key (functions, auth-bridge, accounts, scheduled-job);
  - it is security definer;
  - the last migration statement about it revokes `anon` / `authenticated`.
- Every caller was checked to use the service key:
  - auth-bridge mints a `service_role` token;
  - accounts uses `service_token()`;
  - functions use `serviceRest` / the service client.

| Function (exact signature) | Called by |
|---|---|
| `account_id_for_email(text)` | accounts, functions backend.ts |
| `bump_llm_cache_hit(text)` | functions llm.ts |
| `check_rate_limit(text,text,integer,integer)` | functions rate-limit.ts, backend.ts |
| `drop_empty_account(uuid)` | create-student-users |
| `ensure_and_claim_lot_template(uuid)`, `release_lot_template(uuid,uuid)`, `touch_lot_template(uuid,uuid)`, `save_lot_template(…9 args)`, `save_lot_template(…11 args)` | functions lot-pipeline.ts |
| `extend_all_fixtures()`, `form_all_colleges()`, `notify_weekly_progress()`, `plan_all_weeks()`, `prune_app_events()`, `run_all_seasons()` | scheduled-job (Cloud Scheduler) |
| `form_squads(uuid,uuid)` | create-student-users |
| `log_security_event(text,text,text,uuid,text,text,text,jsonb)` | functions audit.ts, security-log |
| `record_account(text,text,text,boolean)` | functions backend.ts |
| `record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])` | submit-sandbox-task, submit-written-task |
| `record_topic_attempt(uuid,text,text,uuid,integer)` | level-quiz-submit |
| `remove_students(uuid[],uuid,text)`, `student_logins()` | accounts |
| `resolve_account(text,text,boolean)` | auth-bridge |
| `similar_written_submission(uuid,uuid,text,real)` | submit-written-task |
| `touch_streak(uuid)` | voiceScore.ts, mock-interview-score |
| `touch_template(text)` | resume-coding-generate |

### Migration 80
- `migration/80-server-only-functions-revoked.sql`, mirrored as `supabase/migrations/20261103003000_server_only_functions_revoked.sql`.
- What it does:
  - `revoke all … from public, anon, authenticated`;
  - `grant execute … to service_role`;
  - by `regprocedure` (exact signatures).
- Self-check fails if any of the 26 still has PUBLIC / `anon` / `authenticated` execute, or if `service_role` lost execute.
- Applied through the ledger: "LEDGER: 80-server-only-functions-revoked applied and recorded", exit 0.
- Rollback: `migration/80-rollback-server-only-functions-revoked.sql` (re-grants PUBLIC; warned as unsafe).

### Intentionally NOT changed
- **67 user-callable functions:**
  - The browser calls them (e.g. `my_todays_lot`, `rubric_task_view`, `sandbox_task_view`, `my_squad_members`).
  - They stay executable and check the caller inside.
- **7 admin functions:**
  - The browser's admin screens call them.
  - Each checks `is_admin()` inside.
- **139 "pending review" functions**, still executable by `anon` / `authenticated`. Two groups:
  - **33 security-definer functions** that the migrations also meant to revoke, but that only other SQL calls. These are the season / squad engine (`run_squad_week`, `settle_round`, `score_student_week`, `close_season`, …), Lot claiming (`create_lot_for`, `claim_lot_template`, `seed_lot_template`), `has_role`, `suggest_tracks`, `write_audit`, `log_activity`, `record_activity`, `refresh_unlock`, `plan_student_week`.
    - Some may be used inside row-level-security policies, where the caller's own rights are needed.
    - **Not touched; HIGH; next review (D1b).**
  - **Other functions** that are not security definer or have no evidence either way (e.g. `pg_trgm` helpers).
- All are listed by exact signature in `scripts/rpc_manifest.json`.

### Attack tests after the fix (MEASURED, `staging_rpc_authz_check.py`, 7/7)

| Test | Result |
|---|---|
| Privileges of all 26 (SQL, by signature) | PUBLIC false, `anon` false, `authenticated` false, `service_role` true |
| Any function outside the manifest executable by `anon` / `authenticated` | none |
| 26 functions × (anonymous, student) through the API = 52 calls | all refused (401 / 403 `42501` permission denied, or `PGRST202` "no such function for this role") |
| Student calls `record_task_submission` for their own task with score 100 / passed | **403 `permission denied for function record_task_submission`** |
| Anonymous, same call | **401 permission denied** |
| After both attempts | no submission row, task still `pending`, XP unchanged (624 → 624) |

The gate check's first rule, run against the privileges dumped **before** the fix, flags all 26 signatures.

### Backend regression (MEASURED, `staging_d1_regression.py`)
- **Coding Submit through functions:** passed 100; stored once for the right student and task; task completed; no hidden test data in the reply.
- **Written Submit through functions** (uses `similar_written_submission` and `record_task_submission`): graded 100 with 4 criterion rows; stored for the right student.
- **Topic attempt** (`record_topic_attempt`, service key, as `level-quiz-submit` calls it): rating row written.
- **Service-key calls still work:** account lookup (returns the admin id), rate limit (`allowed: true`), `student_logins` (list).
- **Scheduled jobs** `extend-fixtures`, `weekly-progress`, `weekly-plan`: all `ok`. The gate runs `nightly-squads`, `daily-lots`, `weekly-seasons`, `prune-events`.
- No "permission denied" in any staging server log during these flows.
- Voice (`touch_streak`), Lot / template (`*_lot_template`) and sign-in-related paths: covered by the gate's real-audio, crawler and identity steps.
- `resolve_account` (real Google sign-in) **cannot be exercised on staging**: there is no staging login pool. Its service-key path is the one auth-bridge uses (CODE).

### New permanent release-gate step
- `gate "server-only DB functions refused (D1)"` → `scripts/dev-tools/staging_rpc_authz_check.py` + `scripts/rpc_manifest.json`.
- It fails, printing FUNCTION / ACTUAL / EXPECTED, when:
  - a server-only function becomes executable by PUBLIC / `anon` / `authenticated`, or loses `service_role`;
  - **any function not in the manifest** becomes executable by `anon` / `authenticated`, even if the total count is unchanged;
  - any server-only function answers a direct API call from an anonymous caller or a student;
  - a student can forge `record_task_submission`, or a forged attempt changes anything.

### Test data removed (exactly)
- Tasks `AUDIT probe` (`10ad3000-…000999`), `S4 submit probe`, `AUDIT D1 coding submit`, `AUDIT D1 written submit`, with their 3 submissions (cascade).
- 1 `topic_ratings` row (Load Student 14605, topic python).
- The forged-grade probe task deletes itself.
- **Kept as evidence:** coding-audit, voice-case, written-audit and LOAD2K records.


### Final D1 permission matrix (MEASURED on staging after the gate, `has_function_privilege` + ACL)

| Function | PUBLIC | anon | authenticated | service_role | Expected | Result |
|---|---|---|---|---|---|---|
| `account_id_for_email(text)` | no | no | no | yes | server-only | OK |
| `bump_llm_cache_hit(text)` | no | no | no | yes | server-only | OK |
| `check_rate_limit(text,text,integer,integer)` | no | no | no | yes | server-only | OK |
| `drop_empty_account(uuid)` | no | no | no | yes | server-only | OK |
| `ensure_and_claim_lot_template(uuid)` | no | no | no | yes | server-only | OK |
| `extend_all_fixtures()` | no | no | no | yes | server-only | OK |
| `form_all_colleges()` | no | no | no | yes | server-only | OK |
| `form_squads(uuid,uuid)` | no | no | no | yes | server-only | OK |
| `log_security_event(text,text,text,uuid,text,text,text,jsonb)` | no | no | no | yes | server-only | OK |
| `notify_weekly_progress()` | no | no | no | yes | server-only | OK |
| `plan_all_weeks()` | no | no | no | yes | server-only | OK |
| `prune_app_events()` | no | no | no | yes | server-only | OK |
| `record_account(text,text,text,boolean)` | no | no | no | yes | server-only | OK |
| `record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])` | no | no | no | yes | server-only | OK |
| `record_topic_attempt(uuid,text,text,uuid,integer)` | no | no | no | yes | server-only | OK |
| `release_lot_template(uuid,uuid)` | no | no | no | yes | server-only | OK |
| `remove_students(uuid[],uuid,text)` | no | no | no | yes | server-only | OK |
| `resolve_account(text,text,boolean)` | no | no | no | yes | server-only | OK |
| `run_all_seasons()` | no | no | no | yes | server-only | OK |
| `save_lot_template(uuid,uuid,text,text,text,text,text,integer,text)` | no | no | no | yes | server-only | OK |
| `save_lot_template(uuid,uuid,text,text,text,text,text,integer,text,uuid,uuid)` | no | no | no | yes | server-only | OK |
| `similar_written_submission(uuid,uuid,text,real)` | no | no | no | yes | server-only | OK |
| `student_logins()` | no | no | no | yes | server-only | OK |
| `touch_lot_template(uuid,uuid)` | no | no | no | yes | server-only | OK |
| `touch_streak(uuid)` | no | no | no | yes | server-only | OK |
| `touch_template(text)` | no | no | no | yes | server-only | OK |

### Release gate after the fix (MEASURED)

- `FINAL STAGING RELEASE GATE: PASS (commit 2b9c9a5, 2026-10-04T14:25Z)`, exit 0.
- **30 of 30 steps**, including the new D1 step (7/7). No retries.
- Correction: earlier reports said "31/31", but that was the browser step's own count. The gate had 29 steps before D1.
- Staging 5xx during the run, all explained:
  - `scheduled-job?job=daily-lots` 500: the daily-Lots check's deliberate "2,000 students fail" case.
  - transcription-worker 500 / transcriber 503: the voice burst's known 1-job-per-transcriber retry path.
  - **staging API 503 + 500 at 14:25:40, "no available instance"**: staging (11) + production (9) held the whole 20-vCPU quota, so the API could not start a second instance. Shared quota, not D1; the browser step still passed.
- Production: 0 errors during the run.

### Remaining risks
- **D1b (HIGH):** the 33 SQL-internal functions above, still open on staging.
- **D2 (HIGH):** default privileges (below).
- **D3 (LOW):** `admin_users` view without `security_invoker`.
- **D4:** user-callable / admin functions rely on their own internal checks. The 75-check function sweep covers the edge functions, not every RPC.
- **Production:** every grant here is UNVERIFIED until a read-only production check is approved.

## 15. D2 proposal: default privileges (NOT applied)

**Now (MEASURED staging, `pg_default_acl` for objects created by `postgres` in `public`):**
- tables: `anon=arwdDxtm`, `authenticated=arwdDxtm`, `service_role=arwdDxtm`;
- sequences: `rwU` each;
- functions: `X` each, and Postgres's built-in default also lets PUBLIC execute every new function.

So every new table is fully writable by anonymous callers unless RLS is enabled, and every new function is executable by anyone unless revoked. D1 and the `skill_aliases` hole are both this.

**Proposed migration (staging first):**
```
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
-- service_role keeps its defaults (the backend).
```

| | |
|---|---|
| Effect | Only objects created **after** this change. Existing grants are unchanged. A new table or function the browser needs must then be granted explicitly in its migration. A forgotten grant fails closed ("permission denied", easy to see) instead of open |
| Gate | Extend `staging_rpc_authz_check.py` with tables: any table without RLS, or with `anon` / `authenticated` INSERT / UPDATE / DELETE / TRUNCATE and no RLS, fails |
| Rollback | the same three statements with `grant` |
| Production | its `pg_default_acl` is UNVERIFIED (needs the approved read-only check) |
| Risk | a future migration that forgets its grant breaks that feature on staging, which the gate's browser journeys and function sweep should catch before release |

## 16. D1 closure and D1b: SQL-internal functions (staging, 4 Oct 2026)

### D1 proof gaps closed (MEASURED / CODE)
- **Does the committed migration 80 grant execute to PUBLIC? NO.**
  - `migration/80-server-only-functions-revoked.sql` (commit `2b9c9a5`), SHA-256 `f3773e32…64ef`, is byte-identical to `supabase/migrations/20261103003000_server_only_functions_revoked.sql`.
  - Its only grant/revoke statements:
    - line 46 `revoke all on function %s from public, anon, authenticated`;
    - line 47 `grant execute on function %s to service_role`.
  - The committed blob contains no "to public".
- **The confusing line** `grant execute on function %s to public` is line 19 of the separate rollback file `80-rollback-server-only-functions-revoked.sql`. That is the undo script, which restores the open state. It was written in the same step and **never run**: the ledger records only `80-server-only-functions-revoked`.
- **Fresh 26-function matrix:** all `PUBLIC=f anon=f authenticated=f service_role=t`.
- **Clean D1 regression run:** 10/10, including `check_rate_limit` with the real argument names `p_bucket`, `p_subject`, `p_limit`, `p_window_seconds`.
- **D1 gate check rerun:** 7/7; forged grade refused; nothing changed (XP 624 → 624).
- **D1 VERIFIED (staging).**

### D1b: what was reviewed
- Every **security-definer** function (not triggers) that `anon` / `authenticated` could still execute and that was not already classed browser user-callable or admin: **60 functions**.
- For each one, read from staging:
  - execute rights (PUBLIC / anon / authenticated / service_role);
  - use in RLS policies and views;
  - every other public function that calls it, and whether that caller is security definer;
  - whether the body checks `auth.uid()`, `is_admin()` / `has_role()`, college or company ownership;
  - whether it writes;
  - the creating migration's intent.
- Plus code references (browser, servers, scripts).

### Classification (all 60, exact signatures)

| Class | Functions | Evidence | Action |
|---|---|---|---|
| **B. SQL-internal; direct execute revoked** (35) | `advance_season(uuid)`, `backfill_rounds(uuid)`, `claim_lot_template(uuid)`, `close_season(uuid)`, `create_lot_for(uuid,date)`, `ensure_season(uuid)`, `extend_fixtures(uuid)`, `generate_championship(uuid)`, `generate_cohort_league(uuid,boolean)`, `generate_final(uuid)`, `generate_knockout(uuid)`, `generate_round_robin(uuid,boolean,integer)`, `has_role(uuid,app_role)`, `is_duplicate_source(text,text,bigint,real)`, `log_activity(uuid,text,text,uuid,jsonb)`, `lot_needs_writer(uuid)`, `next_lot_source(uuid)`, `notify_retest_unlocks()`, `plan_student_week(uuid,date)`, `prune_bug_finder_runs()`, `prune_rate_limits()`, `qualify_squads(uuid)`, `record_activity(uuid,text)`, `recount_season(uuid)`, `refresh_unlock(uuid,text)`, `reshuffle_quiz_options()`, `resolve_account_uuid(text,text)`, `run_squad_week(uuid,integer)`, `schedule_round_robin(uuid,uuid[],integer,integer,text,text)`, `score_student_week(uuid,uuid,integer)`, `seed_championship(uuid)`, `seed_lot_template(uuid)`, `settle_round(uuid,integer)`, `suggest_tracks(uuid,integer)`, `write_audit(text,text,uuid,jsonb,jsonb,uuid)` | No browser or server code calls them (one test script calls `next_lot_source` with the service key). No policy or view uses them. **Every calling function is security definer** (runs as owner). Most were meant to be revoked by their creating migration. None checks the caller except `write_audit` (uid) | migration 81 |
| **E. Policy / RLS helpers: keep executable** (7) | `is_admin()` (90 policies, 2 views, an invoker trigger), `college_owns_student(uuid)` (2 policies), `is_verified_recruiter()` (2), `my_approved_college_ids()` (7), `viewer_college_id()` (5), `student_is_discoverable(uuid)` (1 policy), `refuse_suspended()` (the API's pre-request hook: must run as the caller) | Used where the caller's own rights apply | unchanged; the gate now **requires** `authenticated` to keep EXECUTE |
| **C. Admin-only, with an internal guard** (6) | `admin_notify_student(uuid,text,text,text,text)`, `admin_trace_errors(integer)`, `admin_trace_funnels(integer)`, `admin_trace_search(text)`, `admin_trace_slow(integer)`, `admin_trace_student(uuid,integer,integer)` | Body calls `is_admin()`. A student calling `admin_trace_search` gets `P0001 admins only` (MEASURED). The admin gets 200 | unchanged; the gate now fails if any admin-only function loses its `is_admin()`/`has_role()` guard |
| **A. User-callable by design** (10) | `can_see_season(uuid)`, `get_leaderboard(integer)` (browser), `my_company_ok()`, `my_recruiter_id()`, `my_season_id()`, `my_shortlists()`, `placement_questions(uuid)`, `respond_to_shortlist(uuid,boolean)`, `submit_placement(jsonb)`, `squad_championship_achievements(uuid)` | Granted to users on purpose in their migrations; check `auth.uid()` or return public data. All except `get_leaderboard` have **no current screen** (legacy features) | unchanged; legacy ones can be retired later |
| **F. Unsafe, needs an owner decision** (2) | `topic_priorities(uuid,integer)`: **no ownership check**, any caller reads any student's topic priorities (LOW, read-only). `notify_all_admins(text,text,text,text)`: **any caller, even anonymous, inserts a notification with any text for every admin** (MEDIUM: spam / phishing inside the admin inbox) | Granted on purpose in stage 10 / 55 migrations, so changing them is a product decision | **BLOCKED / NEEDS REVIEW**; listed as `flagged` in the manifest |
| **G. Unknown** | none among the 60 | | — |

The remaining **79 `pending_review`** entries are mostly **not** security definer (they run with the caller's rights, so RLS still applies), plus trigram helpers. They are listed by signature so any new exposure still fails the gate.

### Attack test (MEASURED, `scripts/dev-tools/staging_d1b_probe.py`)
- Inputs were **random ids only**, so no row matches and nothing can change.
- Functions without arguments that would change data (`notify_retest_unlocks`, `prune_*`, `reshuffle_quiz_options`) were not called; their state is proven by the privilege check.

| | Before migration 81 | After |
|---|---|---|
| 25 functions × (anonymous, student) | **50 / 50 reached the function body** (200 / 204, or an error raised inside: `P0001`, or `23503` = the database refused a missing foreign key) | **0 / 50** (401 / 403 `42501` permission denied) |
| Data changed | none (random ids; the inserts attempted were refused by foreign keys) | none |
| Impact if real ids had been used (INFERRED from the bodies) | Any visitor could close or advance a college's season, run or settle a squad week, create a Lot for any student, seed or claim Lot templates, or recompute scores | blocked |

### Migration 81
- Files: `migration/81-sql-internal-functions-revoked.sql`, mirrored as `supabase/migrations/20261103003100_sql_internal_functions_revoked.sql`; rollback `81-rollback-…` (re-opens; warned).
- **Pre-check inside the migration:** refuses to run if any non-security-definer public function, any RLS policy or any view calls one of the 35.
- Then `revoke all … from public, anon, authenticated` and `grant execute … to service_role`.
- Self-check fails if any of the 35 is still executable by PUBLIC / anon / authenticated, lost service_role, or if `is_admin()` lost authenticated execute.
- Applied through the ledger: "LEDGER: 81-sql-internal-functions-revoked applied and recorded".

### Legitimate paths after migration 81 (MEASURED)
- **Nested calls through user functions, all 200:**
  - `my_suggested_tracks` (→ `suggest_tracks`);
  - `my_week` (→ `plan_student_week`);
  - `my_todays_lot` (→ Lot functions);
  - `my_squad_members`.
- **Admin, all 200:**
  - `admin_trace_search` (→ `is_admin` → `has_role`);
  - reading `user_roles` through the `is_admin` policy.
- **Service key:** `next_lot_source` 200.
- **Jobs:** `weekly-seasons` (→ `run_all_seasons` → season engine) ok, 1 season scored; `nightly-squads` ok.
- **D1 regression:** 10/10 again.
- The release gate covers the rest: crawler (Lot templates), daily Lots, real voice, Run / Submit, browser journeys.

### Permanent gate (`staging_rpc_authz_check.py`, now 11 checks)

Manifest classes (`scripts/rpc_manifest.json`): `server_only` 26, `sql_internal` 35, `admin_only` 13, `policy_helper` 7, `user_callable` 79, `flagged` 2, `pending_review` 79.

The check fails when:
- a server-only or SQL-internal function is executable by PUBLIC / anon / authenticated, or loses service_role;
- a directly callable admin function has no `is_admin()`/`has_role()` in its body;
- a policy helper loses authenticated execute (it would break RLS);
- **any function not in the manifest** becomes executable by anon / authenticated;
- any of 52 server-only or 24 SQL-internal API calls is not refused;
- a forged `record_task_submission` gets through or changes anything.

### D2 proposal update (still NOT applied)
D1 and D1b were both caused by Postgres's default "PUBLIC may execute a new function" plus the schema's default grants.

The D2 migration (§15) should therefore also:
- revoke `EXECUTE ON FUNCTIONS FROM PUBLIC` in the default privileges;
- make the gate's "not in the manifest" rule the safety net for any function that a future migration creates without an explicit grant.

### Release gate after D1b (MEASURED)

**Security result**
- `FINAL STAGING RELEASE GATE: PASS (commit f8d77ac, 2026-10-04T15:42Z)`, exit 0.
- **30 of 30 steps**, including "server-only + SQL-internal DB functions refused (D1, D1b)" 11/11.
- No retries. No "permission denied" in any staging log.

**Capacity / quota result** (staging, during the gate; reported separately, not hidden in the PASS)

| Events | Service | Cause |
|---|---|---|
| 9 × 429, 1 × 503, 2 × 500 within 1.5 s at 15:42:27 on `task_assignments` | staging API | **shared quota**: staging 11 + production 9 = 20 of 20 vCPU; the API could not start a second instance during a burst of parallel page queries in the browser journeys. The browser step still passed |
| 35 × 500 | transcription worker | transcriber at its one-job-per-instance limit (2 × 429, 1 × 503): the voice burst's known queue-retry path; every recording was scored |
| 1 × 500 | functions `scheduled-job?job=daily-lots` | the daily-Lots check's deliberate "2,000 students fail" case |

**Production:** 0 errors during the run.

## 17. Last two D1b functions (migration 82) and D2 safe defaults (migration 83), staging, 4 Oct 2026

Starting commit `21f626c`. Code commits `4f0a9c8` (82) and `89971b0` (83 + gate). Staging only.

### 1. topic_priorities: BEFORE (MEASURED)
- `topic_priorities(uuid,integer)`, security definer, owner `postgres`.
- PUBLIC, anon, authenticated and service_role could all execute it.
- The body read `topic_ratings` for whatever `_student_id` it was given, with **no check of the caller** (CODE).
- No browser, server or SQL caller exists; only `src/integrations/supabase/types.ts` lists it.
- Probe with synthetic students: Student B (Load Student 14607, college 7) with one seeded rating (python 1225). B's rating was returned to:
  - an **anonymous** caller;
  - a same-college student (14617);
  - an **other-college** student (14608);
  - the other college's TPO.

### 2. topic_priorities: FIX (migration 82, CODE)
- It now answers only when the caller is one of:
  - `auth.role() = 'service_role'` (backend);
  - `is_admin()`;
  - the student themself (`student_profiles.id = _student_id and user_id = auth.uid()`);
  - the **approved college that owns the student** (`college_owns_student(student's college_id)`).
- These are existing helpers; there is no new authorization model.
- Otherwise: `42501 not allowed`.
- EXECUTE removed from PUBLIC and anon; kept for authenticated and service_role.

### 3. topic_priorities: ATTACK TEST (MEASURED, API)

| Caller | Expected | Got |
|---|---|---|
| A anonymous | denied | **401** permission denied |
| B Student B → own | allowed | 200 (own rating) |
| C same-college student → B | denied | **403** not allowed |
| D other-college student → B | denied | **403** |
| E1 B's college TPO → B | allowed | 200 |
| E2 other college's TPO → B | denied | **403** |
| E3 admin → B | allowed | 200 |
| F backend (service key) | allowed | 200 |

The migration's own self-check also proved, in its transaction, that a student cannot read another student's priorities and can read their own.

### 4. notify_all_admins: BEFORE (MEASURED)
- `notify_all_admins(text,text,text,text)`, security definer.
- PUBLIC, anon, authenticated and service_role could all execute it.
- The body inserted a notification for every admin with **no caller check**.
- No caller anywhere in the code or the database.
- Inside a **rolled-back transaction**: an anonymous call created 1 admin notification and a student call created 1 more. After the rollback: 0. Nobody was notified.

### 5. notify_all_admins: FIX (migration 82)
- **Backend only:** EXECUTE revoked from PUBLIC, anon, authenticated; granted to service_role.
- The body also refuses unless `auth.role() = 'service_role'` or `is_admin()`.

### 6. notify_all_admins: ATTACK TEST (MEASURED)
- Through the API:
  - anonymous **401**;
  - student **403**;
  - TPO **403**;
  - admin directly through the API **403** (backend-only by design).
- **0 notification rows created** by those calls.
- The backend path works:
  - in a rolled-back transaction: 1 row for the 1 staging admin, 0 after rollback;
  - in the gate: one call with the service key, then the row is removed.

### 7. D2: BEFORE (MEASURED, `pg_default_acl`)
- Only `postgres` owns application objects (86 tables, 5 sequences, 289 functions) and runs migrations.
- Defaults for objects it creates in `public`:
  - tables: `anon=arwdDxtm`, `authenticated=arwdDxtm`, `service_role=arwdDxtm`;
  - sequences: `rwU` each;
  - functions: `X` each, plus Postgres's built-in PUBLIC execute.

### 8. D2: NEW DEFAULTS (migration 83)
```
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;   -- built-in default, global only
```
- service_role keeps its defaults.
- **Existing objects are unchanged.**
- The migration explains how future migrations must grant explicitly:
  - RLS + policy + `grant select` for tables users read;
  - `grant usage` on sequences users insert through;
  - `grant execute` only on functions users call.

### 9. D2: TEMPORARY-OBJECT PROOF (MEASURED)
- Migration 83 itself created `__d2_probe_table` (with a bigserial sequence) and `__d2_probe_fn()`.
  - It checked that anon / authenticated have no table, sequence or function rights, PUBLIC has no execute, and service_role keeps access.
  - It then dropped both and committed.
- The permanent gate repeats this every run, in a transaction that is **rolled back**: `__gate_d2_probe`. Result:
  - open = [] for anon / authenticated / PUBLIC;
  - service_role table / function = t / t.
- 0 probe objects remain (checked).

### 10. Permanent gate (`staging_rpc_authz_check.py`, now 17 checks; gate step "database permissions (D1, D1b, 82, D2 defaults)")
New behaviour tests:
- `topic_priorities`: anonymous 401, same-college 403, other-college 403, other college's TPO 403; self 200, owning TPO 200, admin 200, backend 200.
- `notify_all_admins`: anonymous, student, TPO, admin via the API all refused with 0 rows; the backend path works.
- D2: the rolled-back probe objects are closed.
- No existing table is writable by anon / authenticated without RLS.
- No probe objects are left.

The manifest now lists `notify_all_admins` as **server_only** (27 signatures). The `flagged` list is empty.

### 11. Rollback (both labelled UNSAFE EMERGENCY ROLLBACK)
- `migration/82-rollback-…`: restores the old open functions.
- `migration/83-rollback-…`: restores the open defaults.

### 12. Remaining
- **D3 (LOW)** `admin_users` view: no `security_invoker`. Measured not auto-writable; writes go through `INSTEAD OF` triggers that call `admin_users_write()` (checks `is_admin()`).
- **D4:**
  - 79 `pending_review` functions, mostly not security definer, so RLS applies.
  - The 79 user-callable functions rely on their own checks.
  - The legacy user functions with no current screen (placement, shortlists, …) could be retired.
- **Existing tables** still carry the old broad table grants to anon / authenticated. RLS is on for every table (gate-checked), so this is defence in depth rather than an open hole. Tightening them is a separate, larger change.

### 13. Production
**UNVERIFIED** for every item above: no production database access was used.
