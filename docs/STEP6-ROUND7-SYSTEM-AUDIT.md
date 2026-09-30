# Step 6 — round 7 read-only system audit (2026-09-30)

Scope: the recording (voice explanation) pipeline on **staging**, compared with this repository at
`25a26e5` (branch `work/step6j-release-gates`). **Nothing was changed.** No SQL was applied, no
permissions were changed, no rows were written, and nothing was uploaded or sent to the AI.
Production was **not** queried.

## How the staging database was inspected (read-only)
- Tool: the existing Cloud Run job `prooflab-staging-inspect4` (image `postgres:17`, connects with the
  secret `prooflab-staging-db-uri`, which was never printed). It was run **once**, with a one-off
  `--args` override (the job's saved settings were not changed). Execution `prooflab-staging-inspect4-9m6bp`.
- It was read-only twice over:
  1. `PGOPTIONS='-c default_transaction_read_only=on'` (the session refuses writes).
  2. The script runs inside `begin transaction read only; … rollback;`.
  The log shows `transaction_read_only = on` and `ROLLBACK`.
- It printed structure, permissions, function code hashes and **aggregate counts only**: no row
  contents, transcripts or personal data. Script: `evidence/staging-readonly-audit.sql`. Full output:
  `evidence/staging-readonly-audit-output.txt`. Function-to-repository matching:
  `evidence/staging-function-version-match.txt`.
- Everything else was read with `gcloud … describe/list` (services, images, queue, scheduler, IAM).

## 1. Migrations 41–47: repository vs live staging

Function "code hash" = `md5(prosrc)` on staging, compared with the body of every definition of that
function in the repository's migration files (see the match file).

| Migration | What it adds | Live staging (2026-09-30) | Matches which repository file |
|---|---|---|---|
| **41** transcription jobs | columns `transcription_status` (default `completed`), `_claimed_at`, `_attempts`, `_error`, `_idempotency_key` (UNIQUE); partial index on pending/processing; `claim/complete/fail_transcription_job` | All columns present with the same types and defaults. UNIQUE `voice_explanations_transcription_idempotency_key_key` present. Partial index present. CHECK on `transcription_status` (pending/processing/completed/failed) present. | Superseded by 42, as intended |
| **42** hardening | `transcription_lease_token`; lease-token versions of claim/complete/fail; `reap_stale_transcription_jobs`; revoke from PUBLIC/anon/authenticated, grant `service_role`; revoke UPDATE on the table | `claim_transcription_job(uuid,int)` returns `lease_token`; `complete(uuid,uuid,text,jsonb,int)`; `fail(uuid,uuid,text,bool)`. All SECURITY DEFINER, `search_path=public, pg_temp`, owner `postgres`, EXECUTE **service_role only** (anon/authenticated false). No UPDATE for anon/authenticated. `reap_stale_transcription_jobs` absent (43 dropped it). | Code hashes equal **`42-transcription-jobs-hardening.sql`** and the identical `step6u-combined-41-42-production-execution.sql` |
| **43** durable recovery | `transcription_enqueued_at`, `_reap_claimed_at`, `_reap_attempts`; `claim_transcription_recovery`; the browser-insert guard trigger | All present. `claim_transcription_recovery` service_role only. Trigger `guard_voice_explanations_insert` BEFORE INSERT, enabled. Guard function EXECUTE: **no PUBLIC grant** (service_role only). | Code hashes equal **`step6y-migration-43-production-execution.sql`**, the fixed production script, **not** the original `43-…sql` (different bodies) |
| **44** scoring claim | `scoring_claimed_at`; `claim_voice_scoring` returning boolean | Column present; the function has been replaced by 45's version | Superseded by 45 |
| **45** lease-token scoring | `scoring_lease_token`; claim (returns lease token), complete, fail | All present, service_role only | Code hashes equal the **ORIGINAL `45-voice-scoring-lease-token.sql`**, **not** the fixed `step6dd-migration-45-production-execution.sql` that production runs (see mismatch M1) |
| **46** recruiter provenance | — | Not inspected this round (on hold, outside the recording path) | — |
| **47** revoke UPDATE | revoke UPDATE from anon/authenticated | Holds on staging (the grants list has no UPDATE for them) | — |

Also confirmed live on staging (it closes an earlier uncertainty): `student_profiles_one_id_space
CHECK (id = user_id)` exists, and 24 of 24 profiles have `id = user_id`.

## 2. What is active on staging now (read-only `gcloud`)

| Piece | Live setting |
|---|---|
| Web app | No hosted staging web app was found: every staging service allows only the origin `http://localhost:5173` (`ALLOWED_ORIGINS`). Tests run against a local Vite dev server with `.env.staging` (`VITE_ASYNC_TRANSCRIPTION=true`) |
| API | `prooflab-staging-api`: PostgREST v16.3, anon role `anon`, pool 2 |
| Files | `prooflab-staging-files`: image `prooflab-files:v-no-vercel`, digest `7946c270…`, built 2026-09-15 20:46. `files-service/` has had no commits since `98ac871` (2026-09-15 20:50), so it very probably matches the repository (not proven: images do not record their commit) |
| Functions | `prooflab-staging-functions`: `prooflab-functions:staging-g1v`, digest `daeb3e0a…`, built 2026-09-29 12:37, about 5 minutes before commit `58c7368`, the last functions change (probable, not proven) |
| Worker | `prooflab-staging-transcription-worker`: `prooflab-transcription-worker:g1w`, digest `e5302a8a…`, built 2026-09-29 11:56, about 5 minutes before `3a93b0c`, the last worker change (probable, not proven). `STALE_AFTER_SECONDS=180`, `QUEUE_MAX_ATTEMPTS=3`. **Only** `prooflab-staging-tasks-invoker@` may invoke it (Cloud Run IAM; ingress "all", but IAM is required) |
| Transcriber | `prooflab-staging-transcriber`, Whisper `base` (self-hosted: no per-minute API cost) |
| Queue | Cloud Tasks `prooflab-staging-transcription`: RUNNING, 1 dispatch/s, **max 2 concurrent**, burst 10, 3 attempts, 5–30 s backoff |
| Recovery sweep | Cloud Scheduler `prooflab-staging-transcription-reap`, **every minute**, ENABLED, calling `transcription-reap` with `x-webhook-secret` |
| AI scoring | `voice-score` / `_shared/voiceScore.ts` in the functions service, DeepSeek key from Secret Manager |
| Production | Not inspected this round. According to `docs/STEP6-HANDOFF.md`, migrations 41–45 and 47 are applied there, 46 is not, and **no async pipeline infrastructure exists in production** (no queue, worker or scheduler). Production still records through the synchronous browser path. |

## 3. End-to-end diagnostic map

```
 Browser (VoiceExplainModal)
   │ 1 mic + MediaRecorder  ──(no server)
   │ 2 PUT  files-service  /file/voice-explanations/<student>/<recordingId>-explain.<ext>
   │ 3 POST functions      /transcription-enqueue {storage_path, task_id, proof_id, duration, idempotency_key}
   │        └─ inserts voice_explanations row (service role) ─► Cloud Tasks task "transcribe-<voice_id>"
   │ 4 GET  PostgREST      voice_explanations?id=eq.<voice_id>  (poll every 2.5 s, RLS own rows)
   ▼
 Cloud Tasks ─► transcription-worker (OIDC, tasks-invoker only)
   │ 5 claim_transcription_job(voice_id) ─► read file from bucket ─► transcriber (Whisper)
   │ 6 complete/fail_transcription_job(voice_id, lease_token)
   │ 7 POST functions /voice-score {voice_id} (service role) ─► DeepSeek ─► complete/fail_voice_scoring
   ▼
 Cloud Scheduler (every min) ─► transcription-reap: claim_transcription_recovery ─► re-enqueue / re-score / fail
 Dashboard: StudentVoiceExplanationsCard reads voice_explanations (own rows); recruiters see score/notes only
```

| # | Stage | Correlation IDs available | Logs today | Missing observability | Failure states | Safe read-only diagnostics |
|---|---|---|---|---|---|---|
| 1 | Browser recording | `recordingId` (random UUID; also in the file name), `idempotencyKey`, `tabId`; local record `pl.voiceJob.v3:<recordingId>` | `app_events` step trail (button labels, page, call timings: all function calls, table calls only when failed or slow) | Nothing records mic denial or recorder errors to the server; no recordingId in any server log | mic blocked; recorder failed; over 60 s refused; page left (unconfirmed) | the student's browser storage (`pl.voiceJob.v3:*`); admin Student Trace |
| 2 | Upload (files-service) | storage path = `<student>/<recordingId>-explain.<ext>` | files-service logs only **errors** (`console.error(method, object, err)`); Cloud Run request log | No request id: `storage.ts` uses plain `fetch` (no `x-request-id`); success is not logged; no size/duration check | 400 empty, 401, 403 other folder, 409 exists, 413 >10 MB, 5xx, no answer | Cloud Run request logs for `prooflab-staging-files` filtered by URL path; object existence via the owner's GET (or a proposed HEAD route) |
| 3 | Enqueue | `x-request-id` + `x-session-id` (functions only); `idempotency_key`; returned `voice_id`; task name `transcribe-<voice_id>` | functions JSON logs with `request_id`; `transcription-enqueue` logs errors only | Success is not logged with the key or voice_id; nothing checks that the object exists (proposal 2) | 400 missing fields; 403 path/task/proof not yours; 403 key used by another student; 500; lost answer (the browser retries with the same key) | `voice_explanations` by `transcription_idempotency_key` (aggregate or service role); Cloud Tasks task `transcribe-<voice_id>` |
| 4 | Worker + transcriber | `voice_id`, Cloud Tasks task name, retry count, `transcription_lease_token` | `WORKER: …` lines with voice_id and task name (claim failed, nothing to claim, completed, failed, stale lease) | No `request_id` propagated from enqueue; transcriber latency not logged per job; no queue-depth alert | claim lost; transcriber error/timeout; stale lease; attempts exhausted → `failed` | the row's `transcription_status/attempts/error/claimed_at/enqueued_at`; Cloud Tasks queue stats; worker logs by voice_id |
| 5 | Recovery sweep | `voice_id` lists in the report line | one report line per run; `TRANSCRIPTION-REAP ALERT:` lines (exhausted, unconfirmed, terminal scoring failures) | No per-run duration or recovered-count metric (only the text line) | webhook-secret mismatch; RPC failure; partial failures listed | reap logs; the row's `transcription_reap_claimed_at/attempts` |
| 6 | AI scoring | `voice_id`, `scoring_lease_token`; `llm_usage.request_id` for AI calls | `VOICE-SCORE: claimed / scored = N / too short / lost race / unusable AI answer / AI call failed` | The worker → voice-score call carries no browser `request_id`; per-recording cost is not linked by voice_id | AI error; unusable answer; lost race; too little speech (failed); stale claim | row `status/communication_score/scoring_claimed_at`; `llm_usage` by request_id |
| 7 | Browser polling / result | `voice_id`; local record | table calls logged only when failed or >1.5 s | Poll give-ups ("uncertain") are not reported to the server | read error, missing row, row mismatch (F8), 3 failures → uncertain | the row via the student's own session (RLS) |
| 8 | Dashboard / recruiters | `voice_id` | page trail | — | no row, stale status | `voice_explanations` own-row reads; recruiter RPCs (score/notes only, never audio) |

**Biggest observability gaps** (proposals only, none changed):
1. No single ID runs through every stage (browser recordingId → file path → idempotency key → voice_id → task → worker → scoring).
2. File-service calls carry no `x-request-id`.
3. Enqueue and upload successes are not logged.
4. No alert on queue backlog or age.
5. AI cost is not attributed per `voice_id`.

## 4. Confirmed mismatches and findings (evidence in the ZIP)

| # | Finding | Evidence | Severity / action |
|---|---|---|---|
| M1 | **Staging runs the ORIGINAL migration 45 scoring functions; production runs the fixed step6dd version.** The original has the known race issues documented in `migration/step6dd-staging-rehearsal-2026-09-28.txt`: repeated complete accepted, late fail accepted, TTL takeover, score 150 accepted. Any staging scoring test exercises different code from production. | code hashes `8246246…`, `ed6fa70…`, `ab4cf7b…` equal `45-voice-scoring-lease-token.sql` | HIGH for test validity. Before any real staging scoring test, apply the step6dd fix to staging with separate approval (not done). |
| M2 | The live browser-insert guard has **no `storage_path` ownership check** (N3). | full function definition in the output | Proposal N3 (corrected pattern). Not applied. |
| M3 | `anon` and `authenticated` hold `DELETE, INSERT, SELECT, TRUNCATE, TRIGGER, REFERENCES` on `voice_explanations`. RLS limits INSERT/DELETE/SELECT for authenticated (anon has no policies, so it is denied). **TRUNCATE is not controlled by RLS.** PostgREST cannot issue TRUNCATE, so it is not reachable through the API, but the privilege is unnecessary. | table grants | Proposal: `revoke truncate, trigger, references on public.voice_explanations from anon, authenticated` (needs approval and tests). |
| M4 | `accept_voice_consent()` is executable by `anon` (default PUBLIC grant). It relies on `auth.uid()`; its behaviour for anon was **not** tested. | function ACL | Uncertain. Test with an anon call on staging (read-only effect expected), or revoke from anon (approval needed). |
| M5 | Data shape that the browser must tolerate: 16 of 109 rows have a NULL key; 4 rows have paths outside their own folder (3 `fake/…` fixtures and 1 deliberate cross-folder fixture); **3 paths are reused by several rows, up to 21 rows on one path**. | aggregate counts | Handled in the browser this round (R6-3: a reused path is "ambiguous"). |
| M6 | Deployed images do not record their source commit (only a build time). | artifact list | Proposal: tag images with the commit SHA or label `org.opencontainers.image.revision`. |

## 5. Remaining uncertainties
- Production was not queried this round. Its state comes from the handoff doc, which records the owner's own verification.
- The worker and functions images are *probably* the repository at `3a93b0c` and `58c7368`. The file-service image was built from code unchanged since `98ac871`.
- Migration 46 objects were not inspected.
- `accept_voice_consent` for anon (M4).
- The Postgres regex behaviour of the corrected N3 pattern is checked only in Python. Its self-check must run in Postgres.
- Real Google sign-in, token refresh, and real upload/transcription/scoring timings are not measured.

## 6. Proposed controlled real staging test plan (NOT run; needs your separate approval)

**Preconditions (each is its own approval):**
1. Decide M1: either apply the fixed step6dd 45 functions to staging (recommended, a staging-only DDL with the existing script and verify file), or accept that scoring tests exercise the unfixed staging version.
2. Approve real staging writes for two test students only (t07, t16). New rows get a label (idempotency key prefix `r7-live-`).
3. Approve the AI cost. Each scored recording makes one DeepSeek call (a few paise; measured afterwards from `llm_usage`). Plan: 6 recordings, 12 at most with retries.

**Run** (browser with a real Google sign-in on the local dev server pointed at staging, `VITE_ASYNC_TRANSCRIPTION=true`):

| # | Test | Pass criteria (proved by rows and logs) |
|---|---|---|
| T1 | t07 records 20 s → Saved → score | one row: `transcript_source=server`, `status=scored`, `duration_seconds≈20`; file in `t07/…`; worker `completed` log; `llm_usage` row |
| T2 | t07 records, closes the tab during upload, reopens | at most one row per idempotency key; record shows "unconfirmed" or completes; no orphan job |
| T3 | Two tabs, same task, record in both | two rows, two keys, two files, both scored |
| T4 | t07 signs out, t16 signs in mid-upload (real sessions) | nothing for t07 sent with t16's token (files-service and functions logs show t07 only); t07 later completes it |
| T5 | Network cut during upload (DevTools offline), then Resume | same path (409 or stored), one row |
| T6 | Cross-student: t16 tries to play t07's file | 403 from files-service |

**After:** read-only counts; list only the labelled rows; delete them **only** with your explicit approval
(`STEP6-STAGING-TEST-DATA-CLEANUP.md` style), never other test data. No production is involved.
