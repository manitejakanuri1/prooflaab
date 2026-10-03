# ProofLab — release candidate, pre-production report

Date: 3 Oct 2026 · Branch: `work/stabilization` · Rollback tag: `stabilization-baseline-2026-10-03` (= `main` = `d736e4d`)

**Status: STAGING ONLY. PRODUCTION IS UNTOUCHED AND ON HOLD.** Not merged to `main`, no production migration, deploy, setting, IAM, Scheduler or secret change, no quota request. Going live needs the owner's yes, stage by stage (`PRODUCTION-ROLLOUT-CHECKLIST.md`).

Companion documents: `FINAL-NAVIGATION-MAP.md` · `ZERO-LEGACY-AUDIT.md` · `RELEASE-MANIFEST.md` · `CLOUD-CAPACITY-PLAN.md` · `COST-CONTROL-PLAN.md` · `PRODUCTION-ROLLOUT-CHECKLIST.md` · `PRODUCTION-ROLLBACK-CHECKLIST.md` · `STABILIZATION-EXECUTION-REGISTER.md` (every item with its proof and rollback).

---

## 1. One evidence model

`task_submissions` + `voice_explanations` + resume assessments + current student / college / company / squad data. Proof upload, Trust score, cosigns, conceptual verification, proof review and the old "post a task" marketplace are removed from screens, routes, hooks, server functions and (on staging) the database. A guard in CI stops them returning (45 identifiers, 0 active occurrences).

## 2. Navigation — four destinations per role

| Role | Before | After |
|---|---|---|
| Student | Daily Card · Build-Log · Squad · Profile | **Floor · Build-log · Squad · Profile** |
| College | Home · Students · Squads · Insights | unchanged (now refresh / deep-link / Back safe) |
| Company | Home · Talent · Shortlist · Lots · Submissions · Review · Jobs (7) | **Home · Talent · Lots · Hiring** |
| Admin | Overview · People · Work Queue · Platform | **Home · People · Work · Operations** |

Detail, merges, removals and redirects: `FINAL-NAVIGATION-MAP.md`. Browser proof: 31/31 steps.

## 3. Voice

| | State |
|---|---|
| Pipeline (upload → queue → transcribe → score → Build-log) | PASS |
| Bound to one submission, retries kept, immutable | PASS |
| Queue and burst | PASS |
| Scored against the task and the exact submitted work | PASS |
| English-only | IMPLEMENTED and TESTED (real English accepted; real Hindi refused without an AI call) |
| Indian-English accuracy benchmark | **WAITING_FOR_REAL_AUDIO** — not run; no synthetic substitute was used |

How the English rule works: the transcriber detects the language first (it used to force English, which turns other languages into English-looking text). A recording is refused only when the model is at least 80% sure it is another language **and** gives English 10% or less; everything else — including any uncertain case — is accepted. Accent is never measured. What was heard (language, probabilities, model, settings, the rule) is stored with the recording. A refused attempt has no transcript, is never scored, stays in the history, cannot become the authoritative recording, and the student sees "Please record your explanation in English." and records again. The recorder says: "Please speak in English only. Indian English accents are fully supported."

Transcription settings: faster-whisper `base`, int8, beam 1, voice-activity filter on. Scoring dimensions that exist and are used: explanation score (0–100), match with the submitted work (0–100), flags. None were invented.

## 4. Marks

Build-log entry: **Task result** (score; "Tests passed x of y · language" for code) · **Voice explanation** (score) · **Matches your work** (score) · written **Breakdown** as "criterion name points/max" · **Improve** = the criterion that lost most points · everything longer behind "View detailed feedback". No combined score exists in the backend, so none is shown. Hidden tests, expected output and reference answers never reach the page. **NO SCORING LOGIC CHANGED.**

## 5. Security and identity

| Check | Result (staging) |
|---|---|
| Only the login bridge can sign tokens (F1) | 34/34 |
| Cross-account sweep of all 32 functions + 9 retired names answer 404 | 75/75 |
| Suspended student with a still-valid ticket | refused everywhere, 23/23; restored ticket works |
| Grading type declared; coding without tests refused | 10/10 over 105,058 tasks |
| Scheduler jobs by Google identity; shared webhook secret refused | PASS (23/23 with the runner) |
| Code runner private, reached by service identity; no runner secret | PASS |
| Voice evidence cannot be moved, rewritten or deleted | 14/14 |
| Import all-or-nothing | 7/7 |
| Secrets in the repository | 0 |

F2 (each function on a narrow database right): **IN_PROGRESS**. Classification of the 32 functions:

| Class | Functions |
|---|---|
| No database access needed | run-code, app-guide-chat |
| Already a narrow database function | submit-sandbox-task, submit-written-task, company-lot, security-log, voice-score, transcription-enqueue, transcription-reap, client-log |
| Privileged job (not a user) | scheduled-job, create-student-users, create-college-user, send-onboarding-email, assign_tasks |
| Still the broad role behind an ownership check | resume-* (7), level-* and levels-* (4), task-explain, lot-writer, mock-interview-* (2), interests-analyze, run-sandbox |

The last group is protected by the sweep (every one refuses another account) but has not been moved to narrow rights.

## 6. Operations

| | Result |
|---|---|
| Crawler, real staging run: source → fetch → store → no duplicate → privacy → Lot → wording → own rubric | 11/11 |
| Bug-finder job on staging (plumbing: browser, token from the signer, result stored, clean exit) | 4/4 — sign-in journeys stay production-only (staging has no logins) |
| Alerts | 15 created for staging (`scripts/setup_alerts.py`), production at rollout |
| CI | secret scan, legacy guard, migration check, all test suites, runner container suite, **artifact hand-off on every branch** |
| Migrations | 50–77 on staging through the ledger; changed files refused |

Alerts and their triggers: daily Lots failed for most students (`JOB FAILED: daily-lots`) · for some (`JOB SANITY: daily-lots could not create`) · created nothing · AI usage not recorded (`TELEMETRY PROBLEM`) · account sync aborted · account sync needs review · recordings failed for good (`TRANSCRIPTION-REAP ALERT`) · Cloud Run could not start an instance (quota / no instance) · bridge errors · caller verification problems · crawler zero-new for 21 days · a scheduled job failing · AI timeouts more than 5 in 10 minutes · runner errors more than 20 in 5 minutes · voice queue above 50 for 15 minutes.

## 7. Scale (15,000 synthetic students, staging = smaller than production)

| Test | Result |
|---|---|
| 23 screen queries | all under 1 s |
| Nightly Lots | 15,000 in batches; success / partial / failure reported correctly |
| Browsing | 200 different students at once: no errors; staging's limit about 150 calls/s |
| Run | 42 runs/s, no errors |
| Recordings | 30 at once scored in 73 s |

Limits found: shared 20-vCPU quota (see capacity plan); the API's 30-second request limit (nightly job now batched); database pool size.

## 8. Faults found and fixed in this phase

| Fault | Found by |
|---|---|
| Migration 74 broke creation of new Lot templates (shared trigger function) → migration 77 | the staging crawler run |
| AI calls by scheduled jobs were not recorded in usage (`'system'` is not an id) | the new telemetry log line |
| Nightly Lot job answered "ok" when every student failed, and was cut off at 30 s at 15,000 students | the status proof |
| Unreadable audio was retried for minutes instead of telling the student | the silence case |
| Each tab click wrote two history entries, so Back appeared dead | the browser Back test |

## 9. XP — `OWNER_DECISION_REQUIRED`

Today: Submit → XP is awarded → the spoken explanation is asked for afterwards.
Alternative: Submit → explanation complete → evidence complete → XP awarded.
Nothing was changed. The explanation is required in the flow and bound in the database either way.

## 10. Remaining

**A. Claude can still do without production:** move the "broad role" functions to narrow rights (F2); remove the dead file-grant path; regenerate database types after cleanup; crawler link discovery inside `path_scope`; company submission card in the compact marks layout; automate microphone recording in a browser.

**B. Needs the owner:** quota request; budget; XP decision; 20–30 real consented Indian-English recordings for the benchmark; yes/no on a rehearsal against a copy of production.

**C. Needs production approval:** every rollout stage (migrations, deploys, merge to `main`, identity cutover, Scheduler and IAM changes, alerts, queue and instance settings, permanent drops 66/71/72, old proof files in storage).

**D. Optional after release:** separate Google project for staging; remove the browser-side marker compatibility for `proof_id`; deep bug-finder as its own job.

## 11. Final gate and verdict

See the end of this file (filled in after the final run).
