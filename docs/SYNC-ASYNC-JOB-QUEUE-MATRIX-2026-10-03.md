# Sync / async / scheduled / queue matrix (3 Oct 2026)

Read-only. Tags: SRC, CFG, EARLIER, INFERRED.

## 1. Whole-application action matrix (CURRENT)

| Action | Current mode | What the browser waits for | Timeout | Failure UX | Future candidate (recommendation only) |
|---|---|---|---|---|---|
| Login | SYNC: Identity Platform, then bridge `/token` | 2 calls | bridge 20 s | error toast | keep |
| Resume upload + parse | SYNC (pdf.js local, then `resume-parser` → DeepSeek) | the AI answer | none on AI; Cloud Run 300 s | "try again"; 429 on rate limit (no-op) | sync with an AI timeout, or async with progress |
| Question generation | SYNC | AI | none | error | sync + timeout, or pre-generate |
| Assessment grading + roadmap | SYNC (one request: N short-answer AI calls + 1 roadmap call) | everything | none | error | make the roadmap async |
| Coding round generate | SYNC (cached per profile) | AI on a miss | none | error | keep + validate |
| Coding Run / Submit (resume) | SYNC: runner per test | 1 / 3 runs | own runner 70 s, public 15 s | "runner busy" 503 | keep |
| Daily Lot assignment | SCHEDULED (05:40 IST) | — | 540 s attempt deadline, 2 retries | sanity log "JOB SANITY" | keep (batch per college later, F21) |
| Lot generation | SYNC, browser-triggered (`lot-writer` from `StudentDailyCard`) | not awaited for display: the seed card shows first | none on AI | seed card stays | **async / pre-generate** |
| Task "simple words" | SYNC on first open, otherwise stored | AI on a miss | none | original wording | pre-generate |
| Sandbox Run | SYNC: visible tests | runs | 70 s per run | busy | keep |
| Sandbox Submit | SYNC: all tests sequential | N runs | 70 s each; Cloud Run 300 s | busy 503 | keep (parallel tests later) |
| Written Submit | SYNC: 1–2 AI calls | AI | none | "Grading is busy" 503 | keep + timeout |
| Voice upload | SYNC (files) | upload | files 60 s | retry from the stored blob | keep |
| Voice transcription | **QUEUE** (Cloud Tasks → worker) | nothing (polls) | worker 300 s, transcriber 120 s | "processing"; reaper | keep |
| Voice scoring | **ASYNC** (worker → voice-score) | nothing | none on AI; lease 120 s | failed with a note | keep + AI timeout |
| Crawler | SCHEDULED job (weekly) | — | 1800 s, 1 retry | log only | keep; add a "0 new pages" signal |
| Notifications (email) | SYNC inside the caller (`send-onboarding-email` via Resend) | email API | none found | logged | queue later |
| In-app notifications | DB inserts inside RPCs | — | — | — | keep |
| Analytics / TPO insights | SYNC RPCs | queries | API 30 s | error | keep; materialise later |
| Squad formation | SCHEDULED nightly (`form_all_colleges`) + on import | — | 540 s | sanity | keep |
| Squad scoring / seasons | SCHEDULED Sunday | — | 540 s | sanity log | keep |
| Weekly progress email | SCHEDULED Sunday 23:45 | — | 540 s | — | keep |
| Weekly plan | SCHEDULED Monday 08:00 | — | 540 s | — | keep |
| Account sync | SCHEDULED every 10 min (`accounts /sync`) | — | 120 s, 0 retries | 409 if 0 logins | add a delete ceiling (F6) |
| Step-trail logging | FIRE-AND-FORGET (browser batches every 5 s → `client-log`) | — | — | dropped | keep |
| AI usage / cache / security logs | FIRE-AND-FORGET (`void`), **no-op in production** (F3) | — | — | silent | await + alert |
| Bug finder | SCHEDULED job 5×/day + deep daily (**deep trigger failing, code 7**) | — | 900 s | alert | fix the trigger, restore test logins |

## 2. Cloud Scheduler (CFG 3 Oct): D2 / D3 re-confirmed

| Job | Cron (IST) | Target | Auth | Retries | Deadline | Last status |
|---|---|---|---|---|---|---|
| prooflab-accounts-sync | `*/10 * * * *` | accounts `/sync` | x-webhook-secret | 0 | 120 s | OK |
| prooflab-transcription-reap | `* * * * *` | functions `transcription-reap` | x-webhook-secret | 0 | 60 s | OK |
| prooflab-nightly-squads | `35 5 * * *` | functions `scheduled-job?job=nightly-squads` | secret | 2 | 540 s | OK |
| prooflab-extend-fixtures | `37 5 * * *` | `…extend-fixtures` | secret | 2 | 540 s | OK |
| prooflab-daily-lots | `40 5 * * *` | `…daily-lots` | secret | 2 | 540 s | OK |
| prooflab-prune-events | `10 3 * * *` | `…prune-events` | secret | 0 | 180 s | OK |
| prooflab-weekly-plan | `0 8 * * 1` | `…weekly-plan` | secret | 2 | 540 s | OK |
| prooflab-weekly-seasons | `30 23 * * 0` | `…weekly-seasons` | secret | 2 | 540 s | OK |
| prooflab-weekly-progress | `45 23 * * 0` | `…weekly-progress` | secret | 2 | 540 s | OK |
| prooflab-bugfinder-run | `0 6,10,14,18,22 * * *` | Run Jobs API `prooflab-bug-finder:run` | OAuth rt-scheduler | 0 | 180 s | trigger OK; **job failing** (N1) |
| prooflab-bugfinder-deep-run | `0 4 * * *` | Run Jobs API (deep) | OAuth rt-scheduler | 0 | 180 s | **code 7 PERMISSION_DENIED** (1 Oct 22:30 UTC) |
| prooflab-crawler-weekly | `10 8 * * 0` | Run Jobs API `prooflab-crawler:run` | OAuth rt-scheduler | 0 | 180 s | OK |
| prooflab-staging-transcription-reap | `* * * * *` | staging functions | staging secret | 0 | 60 s | OK |

- **D2:** 12 production + 1 staging = 13.
- **D3:** every job is `Asia/Kolkata`, so there is no UTC shift.
- Deep-run failure cause: INFERRED that the run-with-overrides permission is missing for `rt-scheduler` after G05. **UNKNOWN until the IAM is read.**

## 3. Queues (CFG)

| Queue | Producer | Consumer | Auth | Rate | Retry |
|---|---|---|---|---|---|
| `prooflab-transcription` | functions `transcription-enqueue` (as rt-functions, actAs tasks-invoker) | `prooflab-transcription-worker` | OIDC `prooflab-tasks-invoker`, audience = worker URL | 2 concurrent, 1/s, burst 10 | 3 attempts, 5–30 s |
| `prooflab-staging-transcription` | staging functions | staging worker | OIDC | same | same |
| `prooflab-staging-ai-background` | **none in source** | none | — | 2 / 1/s | 3 |

## 4. Failure scenarios (current behaviour, INFERRED from source and config; nothing tested destructively)

| Scenario | What happens today |
|---|---|
| DeepSeek down | Every sync AI action returns 500/503 after the DeepSeek retries; **with no timeout, a hung DeepSeek holds requests up to 300 s** and can exhaust the 4 × 80 functions slots. Voice scoring fails under its claim (status failed with a note); the reaper re-scores unscored server transcripts |
| Whisper down | The worker fails, Cloud Tasks retries 3 times, then the reaper re-queues (≤ 8 recoveries), then the row is failed. The browser shows processing or failed |
| Cloud SQL down | PostgREST errors; everything fails; the "database down" alert (EARLIER/DOC) |
| Storage upload fails | The browser keeps the blob in memory with a retry; nothing enqueued |
| Code Runner unavailable | `runCode` falls back to the public runners (graded paths); `run-code` returns busy; resume round 503 "runner busy" |
| Cloud Tasks delayed | Rows wait `pending`; the reaper re-enqueues stale/never-enqueued ones |
| Scheduler job runs twice | `create_lot_for` is idempotent (unique `student_id`, `lot_date`); squads/seasons: functions designed for reruns (EARLIER: sanity fix for a no-op rerun); accounts sync re-runs safely (removals already gone) |
| Crawler partially fails | Per-URL catch; other sources continue; no alert for "0 new" |
| PostgREST pool exhausted | 4 × 4 = 16 DB connections; requests queue inside PostgREST and then time out at 30 s (API timeout) |
| Identity Platform partial response | `accounts /sync` pages all logins and refuses on 0. **A partial (for example 60%) list deletes about 40% of students**: no ceiling, no dry run (F6) |
| 500 voice uploads at once | Uploads succeed (files 4 × 80); about 40–50 min transcription backlog; no loss |
| 500 Run | 6 runner instances × 1 means most requests overflow to the public runners (Run on sandbox) or "busy" (`run-code`) |
| 500 Submit | As above × N tests; hidden tests go out to the public runners (F10) |
| Recruiter search spike | `recruiter_talent` per-candidate subqueries; only 16 DB connections: slow (U6) |

## 5. Idempotency and race protections (SRC)

| Area | Mechanism | Gap |
|---|---|---|
| Voice enqueue | unique `transcription_idempotency_key`; owner check | — |
| Transcription | `claim_transcription_job` lease + token fencing; stale 180 s | — |
| Voice scoring | `claim_voice_scoring` lease 120 s + token fencing (migration 45/6DD) | staging still runs the unfixed 45 (N11) |
| Lot generation | `ensure_and_claim_lot_template` lease (2 min) + heartbeat + fenced `save_lot_template` | orphan config rows on a lost race; double spend possible after a 2 min stall |
| Daily Lot rows | unique (`student_id`, `lot_date`) + `on conflict do nothing` | — |
| Submissions | `record_task_submission` (definer) + "already passed" check | **unlimited failed attempts** (each costs AI) |
| Student creation / import | `findAccountByEmail` + `drop_empty_account`; not transactional (F19) | partial state possible |
| Notifications | `notify_weekly_progress` idempotency is **UNKNOWN in production**: migration 40 applied status unverified | — |
| Scheduler jobs | rerun-safe RPCs | — |
| Crawler | canonical URL + content hash | template not refreshed when a page changes |
| AI generation in general | template caches (lot, coding, explainers, levels) | resume questions/retest regenerate each time by design |
