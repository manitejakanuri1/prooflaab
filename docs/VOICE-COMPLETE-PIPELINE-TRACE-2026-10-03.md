# Voice: complete pipeline trace (3 Oct 2026)

Read-only.
- **SRC** at HEAD.
- **CFG** read on 3 Oct.
- **DATA**: 12 production rows.
- **EARLIER**: voice scored 72 end to end on 1 Oct; staging 10-recording load test; reaper fixture.
- **NOT RE-RUN** today: no test student.

## A. Current reality: the production (async) path

```mermaid
sequenceDiagram
  participant B as Browser (VoiceExplainModal)
  participant F as prooflab-files
  participant FN as functions
  participant Q as Cloud Tasks prooflab-transcription
  participant W as transcription-worker (private)
  participant T as transcriber (Whisper)
  participant DB as Cloud SQL via PostgREST
  B->>B: consent check (student_profiles.voice_consent_at), mic permission
  B->>B: record ≤ 60 s (MAX_SECONDS); decoded length checked; too long = not uploaded
  B->>F: upload voice-explanations/<profile>/<file> (upsert:false)
  B->>FN: transcription-enqueue {storage_path, task_id?, proof_id?, duration_seconds, idempotency_key}
  FN->>DB: insert voice_explanations (status pending, idempotency key unique)
  FN->>Q: create task, OIDC as prooflab-tasks-invoker, audience = worker URL
  FN-->>B: 202 queued (browser keeps a recovery record, polls the row)
  Q->>W: POST (max 2 concurrent, 1/s, 3 attempts, backoff 5–30 s)
  W->>DB: claim_transcription_job (lease token, stale after 180 s)
  W->>W: read audio from GCS (own SA)
  W->>T: POST /transcribe (minted ticket)
  T-->>W: text, segments, duration
  W->>DB: complete_transcription_job (fenced by lease)
  W->>FN: voice-score {voice_id} with service_role ticket
  FN->>DB: claim_voice_scoring (120 s lease) → DeepSeek → complete_voice_scoring
  Note over FN,DB: transcription-reap every minute: re-queues stale/never-enqueued jobs (≤ 8 recoveries), scores unscored server transcripts (≤ 5/run)
  B->>DB: polls row; Build-log shows transcript, score, notes, playback via files
```

### A1. Step-by-step: sync or async (SRC)

| Step | Where | Current | Authority |
|---|---|---|---|
| Consent | browser, `voice_consent_at` | SYNC | browser decision, stored server-side |
| Record (≤ 60 s) | browser MediaRecorder | SYNC (local) | browser; the server never re-checks the length except through Whisper's duration |
| Upload | files service, private bucket, `upsert:false` | SYNC | files service: owner folder |
| Row + enqueue | `transcription-enqueue` | SYNC request → **ASYNC queue** | server: `storage_path` must start with `<profile.id>/`; `task_id`/`proof_id` must belong to the student; idempotency key unique |
| Transcription | worker → transcriber | **ASYNC (QUEUE)** | server |
| Scoring | worker → `voice-score` → DeepSeek | **ASYNC** (triggered by the worker) | server; fenced lease |
| Recovery | `transcription-reap` (Scheduler every minute) | SCHEDULED | server |
| Display | Build-log (`useVoiceExplanations`, `StudentVoiceExplanationsCard`) | SYNC read / poll | RLS |

### A2. The legacy synchronous path still exists (F12, SRC)
- It is compiled into the same `VoiceExplainModal`, behind `VITE_ASYNC_TRANSCRIPTION`. Production builds set it to `true` (`.env.production`, CFG via the bundle on 30 Sep, EARLIER).
- **Legacy flow:** the browser posts the audio to `prooflab-transcriber` directly (a public URL with a ticket), then inserts `voice_explanations` itself with `transcript_source='browser'` (policy `voice_own_insert`; the guard trigger forces `browser`), then calls `voice-score`.
- `voice-score` still lets **a student score their own `browser` rows** (`voice-score/index.ts:95-101`). Server rows are refused ("scored automatically").
- **Production data:** all 12 rows are `transcript_source='server'` (DATA). The browser path is unused but still callable by anyone with a student ticket (F12).
- **Migration 46** would make recruiter views count only server transcripts. It is on hold, so `recruiter_talent` counts every scored row, browser rows included (SRC, EARLIER).

### A3. Database (SRC, DATA)
- **Columns on `voice_explanations`:**
  - id, `student_id`, `proof_id` (legacy link), `task_id`
  - `storage_path`, `duration_seconds`
  - transcript, `transcript_source` (browser|server), `transcript_segments`, `word_count`
  - `communication_score`, `communication_notes`, status (pending|scored|failed)
  - `transcription_status`, `transcription_claimed_at`, `transcription_attempts`, `transcription_error`
  - `transcription_idempotency_key`, `transcription_lease_token`, `transcription_enqueued_at`
  - `transcription_reap_claimed_at`, `transcription_reap_attempts`
  - `scoring_claimed_at`, `scoring_lease_token`, `created_at`
- **RPCs:**
  - `claim_transcription_job` / `complete_transcription_job` / `fail_transcription_job` (migrations 41–43);
  - reap claims (43);
  - `claim_voice_scoring` / `complete_voice_scoring` / `fail_voice_scoring` (44 → 45/6DD lease tokens).
- **Triggers:** 4, including `guard_voice_explanations_insert` (43). **Grants:** UPDATE revoked (migration 47). G01 production audit, EARLIER.
- **Production rows:** 12. 10 scored and 2 failed, all `server`/`completed`. Durations 2–60 s; 5 rows are at 60 s, the cap. All 12 linked to `task_id`; 0 to `proof_id`.

### A4. Queue, worker, transcriber capacity (CFG) and bursts (INFERRED from config + EARLIER)

| Item | Value |
|---|---|
| Queue | 2 concurrent dispatches, 1/s, burst 10, 3 attempts |
| Worker | concurrency 80, max instances **unset (platform default)**, 1 CPU / 512 Mi, 300 s |
| Transcriber | 2 vCPU / 2 Gi, concurrency **1**, max **3**, 120 s; Whisper `base` int8 CPU; beam 1; VAD on; **`language="en"` forced** |
| EARLIER throughput | about 13 recordings/min on staging (10 recordings scored in about 45 s) |

| Burst | Expected behaviour (INFERRED) |
|---|---|
| 10 | Done in about 1 min |
| 100 | The queue drains at about 2 at a time: roughly 8–10 min to clear. No data loss: rows wait in `pending` and the browser shows "processing" |
| 500 | About 40–50 min backlog. Cloud Tasks retries (3) can exhaust on transcriber 429/503, after which `transcription-reap` re-queues (≤ 8 recoveries) |
| 1,000 | About 1.5 h backlog. Recovery attempts could exhaust for some rows (`exceeded automatic recovery attempts`, status failed). The cost is bounded by the queue rate. **NOT TESTED** |

The bottleneck is the queue's 2 concurrent dispatches together with the transcriber's 3 × 1 instances. Both are deliberate caps.

### A5. Scoring prompt (SRC `_shared/voiceScore.ts`)
- **Inputs:** task **title** (not the submission), duration, word count, transcript inside `"""`.
- **What it measures:** "**ownership**" (did they do the work), not correctness. Returns `{communication_score 0-100, notes}`.
- **Settings:** temperature 0.3, max 500 tokens, JSON parse is strict (a non-number becomes a failure, not 0).
- **Minimum:** 12 words (`MIN_WORDS`). **No duration or length weighting** (N5: the owner saw 10 s get 55).
- **The submission is never shown to the scorer.** The voice score is **not tied to the content** of the student's work.
- **No AI timeout** (F14). Usage logging is off (F3). Cost UNKNOWN.

### A6. Product rules today (SRC)
- Voice is **independent of Submit**. The record button sits on the Daily Card and task rows. A student can record without submitting, and record **unlimited** times per task (N4). Not required.
- Voice playback goes through the files service (owner/college/admin rules). Recruiter access is through `recruiter_proof_profile` aggregates (SRC).
- Scored audio can still be **overwritten or deleted** in storage (`x-upsert`, DELETE in files-service, F11). The row keeps the score.

## B. Product intent
Submit work, then a **required** voice explanation of that work. Heavy processing happens asynchronously. Evidence appears in the Build-log.

## C. Gap

| # | Gap | Tag |
|---|---|---|
| V1 | Voice is not required after Submit and not limited to one recording per task (N4) | SRC |
| V2 | The score ignores the submission content and has no length gating (N5) | SRC |
| V3 | The legacy browser path is still scoreable (F12); Migration 46 is undecided | SRC |
| V4 | Audio can be changed after scoring (F11) | SRC |
| V5 | English forced, base model; Indian English / Telugu-English accuracy is **UNKNOWN** (no measurement) | SRC |
| V6 | The worker's max instances are unset (harmless only because the queue caps dispatch at 2) | CFG |
| V7 | Good: idempotent enqueue, leases with fencing, reaper, private worker with OIDC invoker | SRC + EARLIER |
