# Step 6 G1 — server-side voice scoring: staging evidence (2026-09-28, UTC)

Staging only. Deployed:
- `prooflab-staging-functions`, image `prooflab-functions:staging-g1` (`/ready` 40/40)
- `prooflab-staging-transcription-worker`, image `prooflab-transcription-worker:g1`, with new env `FUNCTIONS_URL` and timeout 150 s → 300 s

Test recordings reused one real staging audio file (18 words). They went through the real Cloud Tasks queue, worker, transcriber and DeepSeek, with no browser involved.

## Results

| Test | Recording | Result |
|---|---|---|
| 1. Browser closed before transcription | 8a6cbd7e… | Worker transcribed (attempt 1), then requested scoring → scored 55. No browser call |
| 2. Duplicate task delivery (2 tasks created at once) | 4afab94c… | Transcribed once, scored once (45). Second task `dup-…`: "nothing to claim" |
| 3a. Crash between transcription and scoring (scoring URL made unreachable) | 874fb4ba… | Worker: transcript saved, scoring call failed (`Name or service not known`). transcription-reap 28 s later: `scoring recovery … -> scored` (35) |
| 3b. Crash during transcription (staging fault switch) | e4184a57… | Crash 19:01:39. Recovery re-enqueued after the 180 s stale window, then transcribed at 19:05:03 (attempt 2) and scored (55). The original task's retry at 19:06:45: "nothing to claim" |
| 4. Normal end to end | 2428a6be… | Transcribed and scored (55). An extra recovery task arriving mid-job was skipped |

**Scoring claims per recording:** exactly 1 each (log count of `VOICE-SCORE: claimed`). All 5 rows end with `transcript_source=server`, `transcription_status=completed`, `status=scored`. There are 0 unscored server rows left on staging.

**Security (live):**

| Request | Result |
|---|---|
| Forged `service_role` token (wrong key) | 401 |
| `alg:none` token | 401 |
| No token | 401 |
| Direct call to the worker without Google OIDC | 403 |

Code-level only (not live-tested; needs a real minted token):
- The service path rejects anything that isn't a completed `server` transcription (409).
- The student path still requires the recording to be the caller's own (403).

## Existing backlog

The first reap runs after deploy scored the 23 server rows that earlier tests had left unscored:
- 5 per run, one claim each;
- several were marked "too short" with no AI call.

## Key worker log lines

```
18:55:05 WORKER: completed 8a6cbd7e… attempt=1 words=18 db_updated=True
18:55:06 WORKER: scoring requested for 8a6cbd7e…: 200 {'success': True, 'communication_score': 55 …}
18:55:06 WORKER: nothing to claim for 4afab94c… (task=dup-4afab94c…) - already handled or in progress
18:58:33 WORKER: scoring requested for 874fb4ba…: None <urlopen error [Errno -2] Name or service not known>
18:59:03 transcription-reap: scoring recovery 874fb4ba… -> scored
19:01:39 WORKER: FAULT INJECTION - simulating a crash after a genuine claim for e4184a57…
19:05:03 WORKER: completed e4184a57… (task=…-reap-1, attempt=2) words=18 db_updated=True
19:05:04 WORKER: scoring requested for e4184a57…: 200 {'success': True, 'communication_score': 55 …}
19:06:45 WORKER: nothing to claim for e4184a57… (task=transcribe-e4184a57…)
```

The staging worker's fault switch was removed after test 3b, and `FUNCTIONS_URL` was restored after test 3a. Current env names:
`PGRST_JWT_SECRET, POSTGREST_URL, TRANSCRIBER_URL, PRIVATE_BUCKET, STALE_AFTER_SECONDS, QUEUE_MAX_ATTEMPTS, FUNCTIONS_URL`.

---

# G1 review fixes: `_shared/voiceScore.ts` (2026-09-29)

| # | Review issue | Fix |
|---|---|---|
| 1 | The too-short decision wrote without a claim | Claim first. "Too short" is written only through `fail_voice_scoring` under this call's lease. A scored row, or one with a live claim, is never touched |
| 2 | Database errors were reported as "already" or "lost race" | Every claim/complete/fail/read error is checked and returns outcome `error` (503). Nothing is claimed to have happened |
| 3 | Bad AI scores silently became 0 | `parseAiScore` accepts only a number (or numeric string) from 0 to 100. Anything else goes to the failure path: row `failed`, score stays null |
| 4 | No pending result | A live claim elsewhere with no saved score returns `pending` (202, `pending: true`). `already` now means a saved score exists |

**Caller changes: none needed.**
- voice-score returns the result as it comes.
- transcription-reap counts the outcomes.
- The worker logs the reply.
- The browser's synchronous path reads `communication_score`, which is null for `pending` or `error`.

## Unit tests: `supabase/functions/_shared/voiceScore_test.ts`

`npx deno test --allow-env --no-check=remote supabase/functions/_shared/voiceScore_test.ts` → **27 passed, 0 failed**.

The tests use a fake database that follows the migration-45 rules exactly as Step 6DD applied them in production.

- **1a–1d.** Too-short:
  - on a scored row: `already`, row unchanged;
  - with a live claim elsewhere: `pending`, the other lease is unchanged;
  - on an unclaimed row: `too_short`, no AI call;
  - 10 concurrent calls: exactly one write.
- **2 (×5).** A claim, complete, fail (after an AI failure), fail (too short) or read error gives `error` 503, never `already` or `lost_race`.
- **3 (×12).** Unusable answers all give `failed` 502 with the score still null: missing, "abc", null, "", "NaN", 150, -5, true, not JSON, empty, or the AI call throwing. Valid answers work: 0, 100, "72", and 64.6 rounds to 65.
- **4.** A live claim elsewhere gives `pending` 202. An already-scored row gives `already` with the saved score.
- **5.** 20 concurrent requests make **exactly 1 AI call**, 1 save and 1 streak update. A later call gives `already`.
- **6a.** The AI call outlasts the 120 s lease. B re-claims and saves 80, and A's late 20 is rejected (`lost_race`), so the saved result is protected. **Honest: 2 AI calls happened.**
- **6b.** Slow A fails after B took over. A's failure is rejected, and B's claim and score are unaffected.
- **6c.** A caller long after the save gets `already`, with no new AI call.

## Live staging (functions image `staging-g1r`, 40/40 loaded, PG 17.11; staging runs the original, unfixed 45)

| Check | Result |
|---|---|
| L1 normal (13b95428…) | Transcribed, then 1 claim, scored 55 |
| L2 duplicate (ef5c2d62…, 2 tasks) | 1 claim, scored 45. The dup task: "nothing to claim" |
| L3 too-short via reap (801792b3…) | `claimed` → `too short` → `-> too_short`. Row `failed`, notes "Too little speech to score.", claim released |
| Unscored server rows left | 0 |

---

# voice-score access-control fix (2026-09-29, staging image `staging-g1t`, 40/40)

Rule now:
- A student may score only their **own browser** recording (the synchronous path).
- A server-transcribed recording is scored only by an authorised server (`service_role`), and only once its transcription is `completed`.

Read errors return **503** (not 404), and a malformed `voice_id` returns **400**.

Live test: `scripts/dev-tools/g1_access_test.py` (never prints secrets or tokens). It inserts 5 labelled `g1s-test-*` rows and makes 2 real DeepSeek calls.

Student identity: the `t07` password in Secret Manager was rejected (INVALID_LOGIN_CREDENTIALS, tried once). So the test mints the same HS256 token the staging auth-bridge issues after login (`role=authenticated`, `sub` = t07 user id), signed with the key voice-score verifies. This is equivalent for voice-score, but Identity Platform itself was not exercised.

```
rows: {
 "unfinished_server": "e8d628cb-cc84-40ae-878d-5d1366f1e1c5",
 "completed_server": "ed199088-faa5-4b71-95b3-e883dbf28625",
 "own_browser": "e150e8d7-f388-42de-a84b-31898cc3a6e0",
 "other_browser": "6fbf2d96-53c0-49af-b824-893816374919",
 "completed_server_2": "2ea9bbbf-e409-422f-9eb7-d10b2ef11257"
}
PASS  S1 student scores own UNFINISHED server recording: HTTP 403 (want 403) {'success': False, 'reason': 'This recording is scored automatically by the server.'}  row unchanged=True  -> status=recorded score=None
PASS  S2 student scores own COMPLETED server recording (server-only): HTTP 403 (want 403) {'success': False, 'reason': 'This recording is scored automatically by the server.'}  row unchanged=True  -> status=recorded score=None
PASS  S3 student scores own BROWSER recording (sync path): HTTP 200 (want 200) {'success': True, 'communication_score': 85}  row unchanged=False  -> status=scored score=85
PASS  S4 student scores ANOTHER student's browser recording: HTTP 403 (want 403) {'error': 'Forbidden'}  row unchanged=True  -> status=recorded score=None
PASS  S5 server scores COMPLETED server recording: HTTP 200 (want 200) {'success': True, 'communication_score': 85}  row unchanged=False  -> status=scored score=85
PASS  S6 server scores UNFINISHED server recording: HTTP 409 (want 409) {'success': False, 'reason': 'not a completed server transcription'}  row unchanged=True  -> status=recorded score=None
PASS  S7 server scores a BROWSER recording: HTTP 409 (want 409) {'success': False, 'reason': 'not a completed server transcription'}  row unchanged=True  -> status=recorded score=None
PASS  S8 malformed voice_id: HTTP 400 (want 400) {'error': 'voice_id is not a valid id'}

8/8 passed
```

Not live-tested: a real database read failure returning 503. There is no safe way to force one on staging; the 503 path was verified by reading the code and type-checking it.

---

# transcription-worker review fixes (2026-09-29, staging image `g1w`, `ENVIRONMENT=staging`)

- **`complete_transcription_job`: the HTTP status and the boolean are both checked.**
  - `200 + true`: saved. Only then is scoring requested.
  - `200 + false`: stale lease. The task is acknowledged, but nothing is saved or scored here.
  - Anything else (HTTP error, unreachable, malformed JSON, wrong type): **not acknowledged** (500). The lease is released for a retry. That release is safe even if the save actually happened, because `fail_transcription_job` only touches a row that is still `processing` under this lease.
- **`fail_transcription_job`'s answer is checked.**
  - `true`: released.
  - `false`: a newer attempt holds the job. This is not an error.
  - An HTTP, network or malformed failure is logged as `FAIL-REPORT ERROR`.
- **Startup refuses bad config.** The worker won't start if any of these hold:
  - a required setting is missing (including `FUNCTIONS_URL`);
  - `ENVIRONMENT` is not staging or production;
  - `ENVIRONMENT` and the database URL disagree;
  - `FAULT_INJECT_VOICE_ID` is set outside staging.
- Fault injection is also ignored at run time unless `ENVIRONMENT=staging`.
- Scoring log lines show only the HTTP status and the success/pending/lost_race flags. Notes, score and response bodies are never logged.

**Unit tests** (`transcription-worker/test_server.py`, stdlib unittest): **27 passed**.
- Success.
- Stale lease.
- `complete` returning HTTP 500, unreachable, malformed JSON, or 5 wrong types.
- Claim HTTP error and claim malformed.
- Nothing to claim.
- Failed scoring request.
- Transcription error: release, and terminal on the last attempt.
- Fail-report HTTP error, malformed, stale.
- `complete` error and release error together.
- Scoring summary contains no notes or score.
- Config: every required setting, fault injection in production, staging label on a production DB, unknown environment, fault injection inert outside staging, and a real process exit on bad config.

**Live staging:**

| Check | Result |
|---|---|
| W1 normal | Completed, 1 scoring claim, scored. Log: `scoring requested …: HTTP 200 {'success': True}` |
| W2 duplicate (2 tasks) | 1 transcription, 1 scoring claim. Dup: "nothing to claim" |
| W3 missing audio | Attempts 1–2 `terminal=False … released`, attempt 3 `terminal=True … released`. Row `failed`, error "HTTP Error 404", not scored |
| Worker log lines containing "notes" or "communication_score" since deploy | **0** |

---

# transcription-reap review fixes (2026-09-29, staging image `staging-g1u`, `ENVIRONMENT=staging`)

- The logic moved to `transcription-reap/reap.ts`. `index.ts` is a thin HTTP wrapper.
- **A (transcription jobs) and B (scoring) are independent.** Each job is enqueued in its own try. A Google token failure fails that run's jobs (all reported) but never blocks B.
- **No Google token is requested when there are no jobs.**
- **Settings are required and checked:**
  - `ENVIRONMENT` (staging|production), `TRANSCRIPTION_QUEUE`, `TRANSCRIPTION_WORKER_URL` and `TASKS_INVOKER_SA` must be set, with **no staging defaults**.
  - Production may not name a staging resource; staging may not name a production one.
  - `FAULT_INJECT_REAP_FAIL` and `MAX_REAP_ATTEMPTS` are refused in production.
  - With bad settings, part A is skipped **without claiming** (so the bounded recovery attempts aren't burned), and part B still runs.
- **Partial failures are visible:**
  - One summary line per run: `TRANSCRIPTION-REAP OK|PROBLEM {…}`, with ids, counts and error kinds only.
  - Severity is ERROR plus HTTP 500 whenever anything failed (settings, a failed enqueue, jobs about to hit the DB's 8-attempt limit, a scoring DB error).
  - A separate `TRANSCRIPTION-REAP ALERT` line when the DB gives up on jobs.
  - `near_limit` counts jobs within 2 attempts of the limit.

**Unit tests** (`transcription-reap/reap_test.ts`): **18 passed**.
- Settings: staging/production valid; each missing setting; production pointing at staging; test switches in production; a mislabelled environment; bad settings skip the claim but still score.
- Independence:
  - no token when idle;
  - a token failure still lets scoring run;
  - one network failure out of 4 jobs leaves 3 enqueued;
  - HTTP 500 is reported and 409 counts as enqueued;
  - a claim DB error still lets scoring run;
  - one scoring error or throw out of 4 is counted while the others are scored;
  - a scoring list error leaves transcription recovery unaffected.
- Limit: `about_to_exhaust` fails the run; near-limit count; the staging override is used; a simulated 9-run outage is visible as a failure on every run and alerts at exhaustion.
- Fault switch: no token, no task, reported.

**Live staging:**

| Run | Setup | Result |
|---|---|---|
| Normal | — | `TRANSCRIPTION-REAP OK`, 200 |
| Outage run 1 (`FAULT_INJECT_REAP_FAIL=true`, `MAX_REAP_ATTEMPTS=2`) | stuck job R1 + unscored transcript R2 | ERROR `PROBLEM`, 500: R1 `failed[attempt 1]`. **The same run scored R2 (82)** |
| Outage run 2 | — | `PROBLEM`, 500: R1 `failed[attempt 2]`, `near_limit 1` |
| Outage run 3 | — | `PROBLEM`, 500: `about_to_exhaust 1`, plus `TRANSCRIPTION-REAP ALERT: 1 job(s) exceeded automatic recovery attempts` |
| Test switches removed | — | `OK`, 200 |

Final rows: R1 `failed` with "exceeded automatic recovery attempts" (2 attempts); R2 `scored`. The staging functions env now has `ENVIRONMENT` and no test switches.

Note: the existing policy **[P1] "A scheduled job failed"** (`resource.type="cloud_scheduler_job" severity>=ERROR`) covers staging jobs too, so these 3 deliberate failed runs likely sent P1 alert emails. It hasn't been changed; that's a production monitoring decision.

---

# transcription-reap second review (2026-09-29, staging image `staging-g1v`)

1. **Terminal AI scoring failure is alertable.**
   - A `failed` outcome from scoreRecording goes into `scoring.terminal_failures` (ids). It fails the run (500, ERROR) and gets its own `ALERT … failed AI scoring for good` line.
   - Normal outcomes don't fail the run: `scored`, `already`, `too_short`, `pending`, `lost_race`, `not_found`.
   - Any outcome not on either list is recorded as `unexpected` and fails the run.
2. **The recovery-limit alert is accurate.**
   - Before the claim, the ids at the limit are listed (`at_limit`).
   - Only after `claim_transcription_recovery` succeeds are they read back and confirmed as `failed` with "exceeded automatic recovery attempts" (`exhausted_confirmed`).
   - If the claim fails, confirmation isn't attempted. If the read-back fails or doesn't match, `exhaustion_unconfirmed` says why.
   - The two alert lines are distinct: "… are now failed (confirmed): ids" vs "… at the recovery limit, NOT confirmed failed (reason): ids".

**Caller change:** `index.ts` now supplies `listAtLimit` and `confirmExhausted` (read-only selects) in place of the old count query.

**Unit tests** (`reap_test.ts`): **26 passed** (18 earlier + 8 new):
- confirmed after a successful claim;
- claim failed: not confirmed and no read-back;
- partial confirmation;
- read-back failed;
- confirmed vs unconfirmed alert wording;
- `failed` scoring is terminal and fails the run;
- the 6 normal outcomes pass;
- an unknown outcome is a problem;
- the terminal-failure alert line.

**Live staging** (test switches `FAULT_INJECT_REAP_FAIL=true` and `MAX_REAP_ATTEMPTS=1`, stuck job `dfdef0a8…`):
- `TRANSCRIPTION-REAP PROBLEM … "at_limit":["dfdef0a8…"],"exhausted_confirmed":["dfdef0a8…"]`, 500;
- `ALERT: 1 job(s) exceeded automatic recovery attempts and are now failed (confirmed): dfdef0a8…`;
- the row in the DB is `failed` with "exceeded automatic recovery attempts";
- test switches removed (0 left), and the next run is `OK`, 200.

A terminal AI scoring failure was **not** forced live: that would need breaking staging's AI key. It's covered by the unit tests only.

---

# VoiceExplainModal browser corrections (2026-09-29)

Files: `src/components/dashboard/student/VoiceExplainModal.tsx`, `src/lib/voiceJob.ts` (new, pure logic), `src/lib/voiceJob.test.ts` (new), `scripts/dev-tools/voice_modal_browser.mjs` (new).

| # | Issue | Fix |
|---|---|---|
| 1 | Lost enqueue response: "Try recording again" deleted the key | New `uncertain` state: **Resume existing recording** (primary) or an explicit **Abandon it and record a new one**. `start()` refuses to start over a stored job and resumes it instead. The key is cleared only on a confirmed final state or an explicit abandon |
| 2 | Poll failures spun forever | A failed read or an unseen row counts as a failure. After 3 in a row, polling stops and the page shows a clear message plus Resume. The stored job is kept. One check at a time |
| 3 | Short recordings stopped polling by word count | Final only when the server status is `scored` or `failed`; its feedback is shown |
| 4 | Audio after refresh | Resume restores `storagePath`; RecordingPlayback gets `src` **or** `storagePath` (authenticated download), never `src=""` |
| 5 | Duplicate onSaved | `SavedNotifier`: once per recording per stage (transcribed, final), however many poll ticks |
| 6 | Retry metadata | StoredJob now holds `durationSeconds`. First call and every retry use `enqueueBody(job)`: same key, path and duration. Older stored jobs still parse |

Consent screen: "Your college can hear it. Nobody outside your college can." was **wrong**:
- the audio file is owner-only (files-service);
- the college sees a count only (tpo_student_profile);
- ProofLab admins can read the row (is_admin);
- verified companies see the score and notes of a discoverable student, never the audio.

It was reworded to match. "Delete from Profile → Privacy" is **correct**: Privacy deletes the row (voice_own_delete) and the file (owner delete).

Checks:
- `node --test src/lib/voiceJob.test.ts`: **8 passed** (including the onSaved regression test);
- `npx tsc --noEmit -p tsconfig.app.json`: clean;
- eslint on the changed files: clean;
- `npm run build`: OK.

Real browser: Chromium via Playwright, fake microphone playing Windows TTS speech, the site run locally in staging mode on http://localhost:5173 (allowed by staging CORS), signed in as t07 with a token minted like the staging auth-bridge issues.

```
PASS  A1 stored job has voiceId, key, path and duration  (duration=14)
PASS  A2 no <audio> with an empty src after refresh
PASS  A3 audio plays after refresh (authenticated download, blob: URL)  ({"src":"blob:","ready":1,"dur":null})
PASS  A4 server score shown after refresh
PASS  A5 stored job cleared once final
PASS  B1 short recording shows the server's own feedback
PASS  B2 no "Grading" message once final
PASS  B3 polling stopped after the final status  (polls in 8s after final: 0)
PASS  C1 lost response recovered without a new recording  (enqueue calls: 1)
PASS  C2 "Try recording again" never offered
PASS  C3 any retry reused key, path and duration  ([12])
PASS  C4 exactly one server job for that key  (rows=1)
PASS  D1 uncertain state offers "Resume existing recording"
PASS  D2 no plain "Try recording again" while uncertain
PASS  D3 recovery details kept (key, path, duration)
PASS  D4 retried enqueue carried the original duration  (first=12 retry=12)
PASS  D5 resume found the same job; still exactly one row  (rows=1)
PASS  E1 failing progress checks stop with a clear message  (after 23s)
PASS  E2 recovery details kept while uncertain
PASS  E3 resume after the outage completes
PASS  B4 database: short recording marked failed by the server  ({"status":"failed","word_count":4,"communication_notes":"Too little speech to score."})
```

B4 failed in the first run because of a **test** bug: it read the stored job after the app had correctly cleared it. Fixed, and the B section rerun gave 4/4. Final result: **21/21**.

Not checked in the browser: the onSaved count (unit-tested only), and a real Google sign-in (Identity Platform itself was not exercised).

---

# RecordingPlayback failure handling + playback after refresh (2026-09-29)

- `RecordingPlayback.tsx`: `load()` is now try/catch/finally. It checks both `error` and missing data, resets `failed` on each try, ignores a second click while loading, and always clears `loading`. A failed or thrown download shows "Could not load - try again" and never leaves the button spinning.
- `StudentVoiceExplanationsCard.tsx` (the Build-Log Play button): same try/catch/finally.
- The saved-recording link already exists: **Build-Log → Entries → "Spoken Explanations"**, newest first. The first failed run was a test-selector bug (the card title also contains the count badge), not a missing link.

Checks: `tsc` clean; eslint clean on both files.

Real browser: `scripts/dev-tools/voice_playback_browser.mjs`, Chromium with a fake microphone, the local staging-mode site, and t07 signed in with a token like the staging auth-bridge issues.

```
PASS  1 recording saved and queued  (voice 8888ddfb)
PASS  2a failed download: button shows "Could not load - try again" and is not stuck
PASS  2b retry after the failure plays the audio  ({"scheme":"blob","ready":1})
PASS  3a completed recording found in Build-Log after refresh  (status=scored score=85)
PASS  3b Build-Log Play with a failed download shows an error, button not stuck
PASS  3c Build-Log plays the completed recording after refresh  ({"scheme":"blob","ready":4})
PASS  4a second student (t16) is refused t07's audio  (HTTP 404)
PASS  4b owner (t07) control: same URL downloads  (HTTP 200 application/octet-stream 161432 bytes)
PASS  4c no token at all is refused  (HTTP 401)
```

Notes:
- The failed downloads in 2a and 3b were simulated by blocking the files-service request in the browser.
- In 4a/4b/4c the cross-student requests were made from the page origin with t16 and t07 tokens; files-service answers 404 to a non-owner (the same answer as a missing file, by design).
- All test recordings use the same speech file, so 3a identifies the newest entry by position (newest first) plus matching transcript text.

Found, not fixed (out of scope): in the Build-Log list, a recording the server marked "Too little speech" (`status=failed`) still shows a green "Completed" badge, because the badge only distinguishes transcription failures.

---

# Build-Log recordings card: badges and playback (2026-09-29)

- **Status badge** (rules in `src/lib/voiceStatus.ts`):
  - transcription failed → **Failed**
  - pending/processing → **Transcribing**
  - `scored` → **Scored**
  - `failed` (incl. too little speech, AI failure) → **Not scored**
  - `recorded` + server transcript → **Scoring**
  - `recorded` + self-reported/legacy → **Not scored** (never shown as pending)

  "Completed" is gone.
- **Playback:**
  - The one-hour signed URL was replaced by `useRecordingAudio` (logic in `src/lib/recordingAudio.ts`): an authenticated download into a temporary `blob:` URL.
  - A second click while loading is ignored, loading always ends, and a failure shows "Could not load - try again".
  - A replaced blob URL is revoked, and so is the last one when the dialog closes; nothing is created after close.
  - `RecordingPlayback.tsx` now uses the same hook.

Unit tests: `node --test src/lib/voiceJob.test.ts src/lib/recordingAudio.test.ts src/lib/voiceStatus.test.ts` → **22 passed** (8 audio loader, 6 status, 8 earlier). tsc and eslint are clean; `npm run build` is OK.

Browser (local staging-mode site, t07 with a bridge-equivalent token):

`scripts/dev-tools/voice_buildlog_browser.mjs` (no new recordings; 2 labelled rows `g1b-test-*` were added so a legacy self-reported row and a Scoring row appear):
```
PASS  1a every badge matches the database rules  (20 rows {"Not scored":3,"Scoring":1,"Scored":13,"Failed":3})
PASS  1b no row says "Completed" any more
PASS  1c a "too little speech" row shows "Not scored"
PASS  1d a self-reported unscored row shows "Not scored", not pending
PASS  2a failed download: retry button shown and enabled (not stuck)
PASS  2b retry plays through a blob: URL (no signed/shareable link)  (ready=4)
PASS  2c the download went to files-service with the student token  (requests=2)
PASS  2d blob URL revoked when the dialog closes
PASS  3a second student (t16) refused  (HTTP 404)
PASS  3b owner control succeeds  (HTTP 200, 161432 bytes)
```

`scripts/dev-tools/voice_playback_browser.mjs` (RecordingPlayback now on the shared hook; the test was updated to the new failure label):
```
PASS  1 recording saved and queued  (voice aab95d8e)
PASS  2a failed download: button shows "Could not load - try again" and is not stuck
PASS  2b retry after the failure plays the audio  ({"scheme":"blob","ready":1})
PASS  3a completed recording found in Build-Log after refresh  (status=scored score=85)
PASS  3b Build-Log Play with a failed download shows an error, button not stuck
PASS  3c Build-Log plays the completed recording after refresh  ({"scheme":"blob","ready":4})
PASS  4a second student (t16) is refused t07's audio  (HTTP 404)
PASS  4b owner (t07) control: same URL downloads  (HTTP 200 application/octet-stream 161926 bytes)
PASS  4c no token at all is refused  (HTTP 401)
```

Not shown live: the Transcribing badge, which is unit-tested only because a job transcribes within seconds.

---

# Review of fe7a4a9: blob ownership, provenance, score display (2026-09-29)

1. **VoiceExplainModal local blob URLs.** `src/lib/blobUrlOwner.ts` owns the one local `blob:` URL.
   - It is revoked on a failed save (before the job is recorded), on replacement (a new recording or abandon), on close and on unmount.
   - Every release also drops `audioUrl` from `savedResult` (`withoutLocalAudio`), so a revoked URL is never rendered and reopening plays the stored file (authenticated `storagePath`).
2. **Provenance** (`provenance()` in `src/lib/voiceStatus.ts`):
   - pending/processing → **Verifying** (never "Self-reported");
   - transcription failed → **Verification failed**;
   - completed + server → **Server-verified**;
   - otherwise → **Self-reported**.

   Shown in the list as well as the detail view.
3. **Score display** (`displayScore()`): a number only when the status is **Scored**. Inconsistent rows (Not scored/Failed/Scoring/Transcribing plus a stray score) show no number.
4. **Browser assertions strengthened** (no rows created, changed or deleted; the staging `voice_explanations` count was 109 before and 109 after):
   - rows are found by exact `data-voice-id`;
   - the real "Too little speech to score." reason is checked;
   - the Authorization header of every download is compared (never printed) with the signed-in student token, and its `sub` is t07;
   - owner-denied and owner-allowed checks are kept.
5. **Node flag:** Node 22.6–22.17 need `node --experimental-strip-types --test …`; 22.18+ and 23.6+ strip types by default (noted in every test header). The `g1b-test-*` cleanup is proposed in `docs/STEP6-STAGING-TEST-DATA-CLEANUP.md` (not run).

Checks (Node v24.12.0): unit **35/35** (`node --test src/lib/blobUrlOwner.test.ts src/lib/voiceStatus.test.ts src/lib/recordingAudio.test.ts src/lib/voiceJob.test.ts`); tsc clean; eslint clean; `npm run build` OK.

Browser, `scripts/dev-tools/voice_modal_blob_browser.mjs` (new; upload blocked or held in the browser; M3 reuses an existing finished recording):
```
PASS  M1 failed save: the recording's local blob URL was created and then revoked  (created=1 revoked=1 uploads blocked=1)
PASS  M1 no player left pointing at the revoked URL  (audio elements=0)
PASS  M2 closing the dialog revokes the local blob URL  (created=1)
PASS  M2 nothing was sent: no recovery marker left (upload never completed)
PASS  M3 reopened finished recording: no local blob player (nothing to point at)
PASS  M3 playback falls back to the authenticated storagePath download  (ready=4, 1 download(s) with the student's own Authorization header)
PASS  M3 the downloaded blob URL is revoked when the dialog closes
```

`scripts/dev-tools/voice_buildlog_browser.mjs`:
```
PASS  1a every badge matches the database rules  (20 rows {"Scored":14,"Not scored":3,"Failed":3})
PASS  1b no row says "Completed" any more
PASS  1c a "too little speech" row shows "Not scored"
PASS  1d a self-reported unscored row shows "Not scored", not pending
PASS  1e provenance badge in the list matches the database for every row  ({"Server-verified":15,"Self-reported":2,"Verification failed":3})
PASS  1f a number is shown only on Scored rows, and it is the saved score  (14 numbers shown)
PASS  1g no contradictory "Not scored/Failed/Scoring + NN/100" in the list
PASS  1h exact too-short recording: detail shows "Too little speech to score.", Not scored, no number  (voice 582943b7)
PASS  2a failed download: retry button shown and enabled (not stuck)
PASS  2b retry plays through a blob: URL (no signed/shareable link)  (ready=4)
PASS  2c the download went to files-service with the student token  (requests=2)
PASS  2e every download carried the signed-in student's own Authorization header (value not printed)  (2 request(s), sub=t07)
PASS  2d blob URL revoked when the dialog closes
PASS  3a second student (t16) refused  (HTTP 404)
PASS  3b owner control succeeds  (HTTP 200, 161926 bytes)
```

**Genuine Google sign-in: UNTESTED.** Every browser run used a session minted like the staging auth-bridge issues it. voice_playback_browser.mjs was not re-run, because it creates a recording.

---

# VoiceExplainModal lifecycle and concurrency (2026-09-29)

Helpers: `src/lib/voiceLifecycle.ts` (tested in `voiceLifecycle.test.ts`).
- **Epoch:** bumped on close, unmount, abandon and each new recording. Every async continuation checks it before touching the UI, the blob URL or the marker.
- **Page-wide `uploadRegistry`:** tracks a save from before the upload until it ends, so it outlives the dialog.
- **`safeStore`:** localStorage with an in-memory fallback.
- **`scoreToShow`:** returns a number only for status `scored`.
- **`markerBelongsTo`:** a marker is cleared only by its own recording.

Modal fixes:
1. One Start at a time: a guard, plus the button is disabled while starting. A microphone grant that arrives after close or unmount stops the stream and starts no recorder.
2. A save is registered page-wide before the upload. A reopened dialog shows "still uploading", offers no Start button, and resumes when the save ends.
3. Server work (upload, marker, enqueue) always finishes after close; UI and blob updates happen only for the current epoch. The async path never restores a revoked URL. The sync path creates no blob URL after close (`onSaved` still fires). Reopening plays the stored file.
4. Polls carry the epoch and voice id: a stale answer is ignored, and it can never clear another recordings marker.
5. Scores are shown and exported only for server status `scored` (sync path: only on `success:true`). The recovery marker survives blocked localStorage (memory fallback). Consent resets per student and ignores stale answers; a failed lookup asks again.

Unit: `node --test src/lib/voiceLifecycle.test.ts src/lib/blobUrlOwner.test.ts src/lib/voiceStatus.test.ts src/lib/recordingAudio.test.ts src/lib/voiceJob.test.ts` → **45/45**. tsc and eslint clean; `npm run build` OK.

Browser: `scripts/dev-tools/voice_modal_lifecycle_browser.mjs`. It is deterministic: the upload, enqueue and polls are faked in the browser, every other write is blocked, and the microphone sits behind a test-controlled gate.

Staging counts before → after: voice_explanations 109→109, app_events 240→240, llm_usage 0→0.
```
PASS  L1 late microphone grant after close: stream stopped at once, no recorder started  ({"calls":1,"recorders":0,"states":["ended"]})
PASS  L2 rapid double Start: one microphone request, one recorder  ({"calls":1,"recorders":1})
PASS  L2 the single recording completes normally (faked upload/enqueue, scripted poll)  (uploads=1 enqueues=1)
PASS  L3 closing during upload revokes the local blob URL
PASS  L3 the save still finished after close: marker with the job id was written
PASS  L3 reopened: no revoked URL in the player; authenticated stored-file playback offered  (audio=0 playButton=1)
PASS  L4 reopened during upload: waits for it, no Start button (no second recording)  (start buttons=0)
PASS  L4 the in-flight save is picked up and finishes; still one upload, one enqueue, one recorder  (uploads=1 enqueues=1 recorders=1)
PASS  L5 stale poll answer after close did not clear the recovery marker
PASS  L5 reopened: current answer shown, stale "failed" never displayed
PASS  L6 localStorage blocked (every access threw): close/reopen still resumed the job from memory  (storage throws=9)
PASS  L7 inconsistent record (status failed + score 85): feedback shown, no number
PASS  L8 consent lookup fails: consent is asked again, no Start button
INFO  writes blocked in the browser: ["rpc touch_my_activity","function task-explain","function task-explain","rpc touch_my_activity","function task-explain","function task-explain","rpc touch_my_activity","function task-explain","function 
INFO  RPCs the page called (allowed through): ["my_rank","my_todays_lot"]
```

The two earlier failed attempts of this script (a test wait bug, then a missing fake job completion) let the pages own `touch_my_activity` RPC reach staging a few times. That updated t07s `last_active` and created no rows. The script now blocks every RPC except the read-only `my_rank` and `my_todays_lot` (the latter is declared `stable`).

---

# VoiceExplainModal lifecycle, second review round (2026-09-29)

On top of 47b0f53 (epoch guard, upload registry, safeStore, scoreToShow, marker ownership):

1. **One `endSession()`** is used for a user close, a parent `open=false` (new effect) and a student/task/proof change (new effect).
   - A late microphone grant in any of these cases stops the stream and starts no recorder.
   - A context change resets the result, key and error, then resumes **only the new contexts** job. The reviews harness found this ordering bug, and it is fixed.
2. AudioContext / MediaRecorder / `rec.start` failure releases the microphone, rAF and context, and shows a recoverable error.
3. The 60 s limit uses real elapsed time (`recordingClock`): it is checked every 250 ms, by a timer aimed at the deadline, and on `visibilitychange`. The duration sent is `recordedSeconds`, capped at 60.
4. Recovery details carry `studentId`/`taskId`/`proofId`. A marker is resumed only in a matching context (`jobMatchesContext`), and a retried enqueue re-sends the jobs own task/proof.
5. A lost enqueue answer resumes with `ownSave` (the save does not wait on itself), so the student is never stuck on "Uploading". Retries always reuse the same idempotency key.
6. PDF export goes through `exportEntry`: the score is exported only when it is the confirmed, shown score.

Unit: `node --test src/lib/voiceLifecycle.test.ts src/lib/voiceJob.test.ts src/lib/blobUrlOwner.test.ts src/lib/voiceStatus.test.ts src/lib/recordingAudio.test.ts` → **50/50**. tsc clean; eslint on changed files: 0 errors (1 warning in the test-only harness); `npm run build` OK, with the harness not in `dist`.

Browser, deterministic, staging reads only. Uploads, enqueue, polls and consent are faked; every other write is blocked. Staging before and after the runs: voice_explanations 109, app_events 240, llm_usage 0, task_explainers 1, and t07 `last_active` unchanged.

`scripts/dev-tools/voice_modal_harness_browser.mjs`, via the test-only harness `scripts/dev-tools/harness/voice-modal-harness.html` (dev server only, not in the build):
```
PASS  H1 parent sets open=false: late microphone grant -> stream stopped, no recorder  ({"calls":1,"recorders":0,"tracks":["ended"]})
PASS  H2 account change: late microphone grant -> stream stopped, no recorder  ({"calls":1,"recorders":0,"tracks":["ended"]})
PASS  H3 unmount: late microphone grant -> stream stopped, no recorder  ({"calls":1,"recorders":0,"tracks":["ended"]})
PASS  H4 AudioContext fails: microphone released, recoverable error shown  ({"calls":1,"recorders":0,"tracks":["ended"]})
PASS  H4 AudioContext fails: "Try recording again" returns to Start
PASS  H5 MediaRecorder fails: microphone released, recoverable error shown  ({"calls":1,"recorders":0,"tracks":["ended"]})
PASS  H5 MediaRecorder fails: "Try recording again" returns to Start
PASS  H6 real elapsed-time limit: recorder stopped by one late tick after 61 s; length sent capped at 60  (duration_seconds=60)
PASS  H7 rapid double Start: one permission request, one recorder  ({"calls":1,"recorders":1,"tracks":["live"]})
PASS  H8 close during upload: local blob URL revoked
PASS  H9 reopen during upload: waits, no Start button
PASS  H10 upload success after close: no revoked URL restored; stored-file playback offered; one upload/enqueue  (audio=0 uploads=1 enqueues=1)
PASS  H11 late poll after account change: ignored, A's recovery marker kept
PASS  H12 account change: B is asked for consent (A's yes not reused)
PASS  H13 switching back to A resumes A's own job (context matched)
PASS  H14 lost enqueue answers: "Resume existing recording" shown (not stuck on Uploading)  (enqueue attempts=2)
PASS  H15 every retry reused the same idempotency key, path and duration (no second job)
PASS  H16 resume found the existing job by its key: no new enqueue; storage was blocked throughout  (storage throws=8)
PASS  H17 scored 77: number shown and exported  (shown=1 pdfHasScore=true)
PASS  H18 status failed + stray 85: number neither shown nor exported  (shown=0 pdfHasScore=false)
INFO  writes blocked in the browser: []
```
`scripts/dev-tools/voice_modal_lifecycle_browser.mjs` (real task page, regression):
```
PASS  L1 late microphone grant after close: stream stopped at once, no recorder started  ({"calls":1,"recorders":0,"states":["ended"]})
PASS  L2 rapid double Start: one microphone request, one recorder  ({"calls":1,"recorders":1})
PASS  L2 the single recording completes normally (faked upload/enqueue, scripted poll)  (uploads=1 enqueues=1)
PASS  L3 closing during upload revokes the local blob URL
PASS  L3 the save still finished after close: marker with the job id was written
PASS  L3 reopened: no revoked URL in the player; authenticated stored-file playback offered  (audio=0 playButton=1)
PASS  L4 reopened during upload: waits for it, no Start button (no second recording)  (start buttons=0)
PASS  L4 the in-flight save is picked up and finishes; still one upload, one enqueue, one recorder  (uploads=1 enqueues=1 recorders=1)
PASS  L5 stale poll answer after close did not clear the recovery marker
PASS  L5 reopened: current answer shown, stale "failed" never displayed
PASS  L6 localStorage blocked (every access threw): close/reopen still resumed the job from memory  (storage throws=9)
PASS  L7 inconsistent record (status failed + score 85): feedback shown, no number
PASS  L8 consent lookup fails: consent is asked again, no Start button
```

## Lifecycle round 3 (recovery identity, partial storage, cross-context saves, stale requests, consent, audio length)

Staging only. No SQL, no migrations, no deployment, no staging rows created, changed or deleted.
Browser tests fake every write in the browser; staging counts were identical before and after
(voice_explanations 109, app_events 240, llm_usage 0, task_explainers 1, t07 last_active unchanged).

What changed (VoiceExplainModal.tsx, lib/voiceJob.ts, lib/voiceLifecycle.ts):
1. Recovery and upload slot = student + task + proof, nulls included: `pl.voiceJob.v2:["<student>",<task|null>,<proof|null>]`.
   Two proofs under one task no longer share a marker or an upload slot.
2. Older markers (old key `pl.voiceJob.<student>.<task ?? proof>`) are read but never trusted by key or path.
   A marker with its own student/task/proof fields decides by itself. One without them is checked against
   the student's own server row (by voiceId, else by idempotency key, else by storage path):
   - row for this exact work: moved to the new slot, then resumed (no new job);
   - row for other work: left untouched, Start offered;
   - lookup failed: "Check again" / "Keep it aside" (details kept under `pl.voiceJob.setAside:<key>`, never deleted);
   - never reached the server: the same two, plus an explicit "It was for this work - save it here".
   No silent attach, overwrite, delete or re-enqueue with a guessed task/proof.
3. safeStore: a failed write keeps the new value in memory, a failed removal keeps a tombstone (and blanks the
   value where writes still work). Both win over older persisted values for this page; later accesses write them
   through once storage works again.
4. Each recording is fixed at Start (id, student, task, proof, slot, idempotency key, epoch). Saves are guarded per
   recording, markers are written to the recording's own slot, and a marker is updated only while it still holds
   the same key (an abandoned job is never written back).
5. Progress checks, resumes and lookups are owned by session + job/slot, and time out (15 s checks/lookups,
   30 s enqueue), so a request that never answers cannot block a newer session.
6. Consent is stored with the student it was answered for. A late "I understand" from another student or a closed
   session is ignored. Start refuses to open the microphone without the current student's own consent.

### 60-second limit: what can still exceed it
- Before: the clock used real elapsed time and capped `duration_seconds` at 60, but the AUDIO could be longer.
  A tab that is suspended or frozen (mobile app switch, OS sleep, browser tab freezing) runs no timers, while the
  recorder may keep capturing. On wake, the stop lands late. `duration_seconds` says 60, the file holds more.
- Browser mitigations now:
  1. The recording stops (and is saved) the moment the page is hidden, frozen or left (`visibilitychange` hidden, `freeze`, `pagehide`).
  2. The length is measured from the stop request, not from when the recorder finished.
  3. Before upload the audio is decoded; if it is longer than 60 s + 2 s it is NOT uploaded and the student is asked to record again.
- Remaining gap: a browser that cannot decode its own recording (decode fails) is let through with only the capped
  `duration_seconds`. A modified client can also upload anything. **Server-side enforcement is still required**:
  the transcription worker (or files-service) should check the real audio duration and file size and reject or
  trim anything over the limit. This is not implemented here; it needs a separate, approved backend change.

### Test results (this round)
- Unit: 60/60 (voiceLifecycle, voiceJob, blobUrlOwner, voiceStatus, recordingAudio).
- `tsc --noEmit -p tsconfig.app.json`: clean. ESLint on changed files: 0 errors, 1 warning (test harness).
  Full-repo `eslint .` still reports 286 errors, all in files this round did not touch.
- Build: OK; the harness is not in `dist`.
- Harness, async path: 45/45, run twice (H1-H37). H36 (hidden tab) and H37 (75 s decoded audio) are SIMULATIONS.
- Harness, sync path (dev server with `VITE_ASYNC_TRANSCRIPTION=false`, `MODE=sync`): 3/3.
- Real task page (`voice_modal_lifecycle_browser.mjs`): 13/13.

## Lifecycle round 4 (round-3 independent audit, findings F1-F9)

Browser code only. No SQL, migrations, deployment, production configuration or staging row changes.
Every browser test fakes the file service, enqueue, progress rows, lookups, consent and inserts.

| Finding | What changed in the browser |
|---|---|
| F1 durable moves | `safeStore.set/remove` now return whether the change is really in storage (a write is read back). `moveDurably` deletes the old record only when the new one is durably stored; otherwise the old one stays in storage and is hidden on this page only. "Keep aside" is an in-place flag on the recording's own record (nothing moved or deleted). |
| F2 multiple tabs | One record per recording (`pl.voiceJob.v3:<recording id>`), never one per slot, so tabs cannot overwrite each other. Each record carries the tab handling it and a heartbeat (every 5 s; cleared on `pagehide`). Another open tab's recording is left alone and the student is told; a record whose heartbeat is gone (closed, crashed, navigated) is picked up and checked with the server. |
| F3 late recorder events | Each recorder has its own microphone stream, chunk buffer, meter and animation frame. A late `dataavailable`/`stop` only touches its own session. |
| F4 account binding | A recording starts only if the signed-in account is the page's student. Immediately before every request for a recording (upload, lookup, existence check, enqueue, progress check, sync transcription, insert, scoring, consent) the signed-in account is compared with the recording's owner; if it differs, nothing is sent and the record is kept for the owner. |
| F5 uploads | Records now have stages: `recording` (audio only in this page's memory), `uploading` (written BEFORE the upload is sent), `uploaded`. Outcomes: success or 409 = stored; an HTTP refusal = not stored (said, with the reason; record removed); no answer or a 120 s timeout = unknown (audio kept in memory, record kept, "couldn't confirm"). A later resume re-sends to the same path (409 = already stored) or, without the audio, checks whether the file exists (authenticated download). Audio is never written to browser storage: after a reload, audio that never reached the server is gone, and the student is told plainly. |
| F6 kept-aside recordings | Listed under Start (this student only), with Check (server row / file existence), "Save it to this work" (only when it was never processed) and "Remove from this list" (explicit, local only). They survive reloads. Nothing is removed automatically. |
| F7 storage paths | `<student>/<recording id>-explain.<ext>`: a random id fixed at Start and reused by every retry. Never the clock. |
| F8 authoritative rows | Before a row is shown or attached, its own student/task/proof, storage path and idempotency key (when still set) must equal the record's. A mismatch shows "we can't confirm it belongs to this work"; nothing is shown, attached or deleted. |
| F9 leaving the page | The recording screen says: keep the page open until "Saved"; switching away stops the recording; closing/leaving before then means it may not be saved. The browser asks before leaving while a recording is unsent. After a close/navigation, the next visit says plainly that it was not saved (it never claims otherwise). |

Behaviour change to note: resuming a record now also retries a lost enqueue answer once (same key) before asking the student.

### Backend proposals (NOT implemented; each needs separate approval)
1. **Audio length and size.** files-service accepts up to 10 MB for every bucket (`files-service/main.ts` MAX_BYTES, lines 36-37 and 298-302). Proposal: a per-bucket limit for `voice-explanations` (60 s of Opus at 96 kb/s is about 0.75 MB; allow 2 MB), and a real-duration check in transcription-worker before Whisper (reject over 62 s as "too long", no scoring).
2. **Enqueue should check the file exists.** `transcription-enqueue/index.ts` (lines 90-133) checks path ownership, task and proof, but not that the object exists. A job can therefore be created for a missing file. Proposal: a storage existence check before the insert.
3. **Cheap existence check.** The browser currently checks existence by downloading the file (at most about 1 MB). Proposal: a `HEAD` route in files-service that returns 200/404 with the same owner check.
4. **Orphaned files.** A recording uploaded but never enqueued (tab closed after the upload, or removed from the kept-aside list) leaves a file with no row. Proposal: a scheduled cleanup of `voice-explanations` objects older than N days that have no `voice_explanations` row (dry-run report first).
5. **Idempotency under real concurrency.** The key column is `unique` (migration 41, line 19) and enqueue does insert-then-select. Parallel real calls with one key are not proven here; verify with backend tests or an approved controlled staging run.

### Test results (round 4, actually executed)
- Unit (Node test runner): 72/72, including `src/lib/voiceRound4.test.ts`. Each F1/F2/F7/F8 block first reproduces the defect with the previous protocol, then shows the correction.
- `tsc --noEmit -p tsconfig.app.json`: clean. ESLint on the 10 changed files: 0 errors, 1 warning (test harness). Full-repo `eslint .`: 286 errors / 16 warnings, the same baseline as before this round (no new errors).
- Build: OK. The test harness and the test-only session hook are not in `dist`.
- Browser harness, queued path: 71/71, run twice back to back. An earlier run made while a full build and lint were running at the same time had 2 timing failures (H14, F6c). Both passed 3/3 when re-run alone and in the two clean full runs.
- Browser harness, non-queued path (`VITE_ASYNC_TRANSCRIPTION=false`, `MODE=sync`): 6/6.
- Real task page (`voice_modal_lifecycle_browser.mjs`): 13/13 (its fake rows now carry owner fields, as the real server's do).
- The same new tests against the previous code (5d42331, with only the new harness and test hook added): queued 2/23 and non-queued 3/6. The defect reproductions include:
  - F1b: the kept-aside record was lost on reload.
  - F2a/F7: a path collision, so only 1 of 2 tab saves went through.
  - F4a and S6: A's audio was sent (and, on the non-queued path, uploaded and inserted) with B's session.
  - S5: B could not record while A's late recorder events were pending.
  Some other old-code failures come only from screens that did not exist before.
- Staging counts were identical before and after every run.
- Simulations: F2d (crashed holder, via a clock 20 s ahead), H6 (throttled clock), H36 (hidden tab), H37 (75 s of decoded audio). Every network write is faked.
- Not run: `voice_buildlog_browser.mjs` and `voice_modal_blob_browser.mjs` (they open real pages without blocking `touch_my_activity`, which would update t07's `last_active`); `voice_playback_browser.mjs` and `voice_modal_browser.mjs` (they create recordings).

## Lifecycle round 5 (round-4 independent audit, R4-1 to R4-3)

Browser code only. No SQL, migrations, deployment, production configuration or staging row changes.

| Item | Change |
|---|---|
| R4-1 transient HTTP errors | `uploadOutcome`: only 400, 413, 415 and 422 are a permanent refusal of the file. Every other failure (no answer, a timeout, 401, 403, 404, 408, 429, 5xx) is "unknown". On "unknown", the file is first looked for with the owner's session: if it is there, the recording carries on. If not, the record and the in-page audio are kept, the student sees "couldn't confirm", and resume re-sends to the same path with the same key. A record is never deleted on a refusal if an earlier attempt has meanwhile been confirmed stored. |
| R4-2 per-recorder times | `MediaSession` holds its own `startedAt` and `stopAt`, set by Stop, or by close/leave through `endMedia`. A delayed `onstop` computes its length from its own session. The shared `stopAtRef` is removed. |
| R4-3 heartbeat silence | A missing heartbeat never produces "lost". When the audio is not on this page and the file is not on the server, the new "unconfirmed" screen says so: "hasn't reached the server; if another tab or window is still sending it, keep that open; if you closed or reloaded the page while recording, it was not saved". Its choices are "Check again" and "Keep it aside" (the record is kept, never deleted). "Remove from this list" is disabled while another open tab still owns the record. If the other tab finishes later, it completes the same record and then clears it. |
| Test-only session hook | `__setSessionForTests` now does nothing unless `import.meta.env.DEV` (the Vite dev server). Its body is removed from production builds. |

### Identity mapping (read-only evidence)
- **Parent components pass `studentId={profile.id}`:**
  - `src/components/dashboard/student/StudentAssignedTasksPage.tsx:602`
  - `src/components/dashboard/student/StudentDailyCard.tsx:395`
  - Both components get `profile` from `useStudentProfile()`.
- **`useStudentProfile` loads the profile by the signed-in user:** `src/hooks/useStudentProfile.tsx:37-46` runs `supabase.auth.getUser()` and then `student_profiles ... .eq("user_id", user.id)`.
- **The session's `user.id` is the database token's subject:** `src/integrations/google/identity.ts:266` and `:330` set `id: subjectOf(token)`.
- **The schema enforces equality:** `supabase/migrations/20260815000000_stage1_identity_and_intake.sql:75-98` defines `id uuid primary key references auth.users(id)`, `user_id uuid not null unique references auth.users(id)`, and `constraint student_profiles_one_id_space check (id = user_id)`. No later migration drops it (searched the repository).
- **Server side:** `transcription-enqueue` resolves the profile by `user_id = JWT sub` and requires `storage_path` to start with `profile.id/`. The two are the same value because of the constraint.
- **Staging data (read-only GET, service token minted in memory):**
  - `student_profiles` rows = 24; `id == user_id` for 24, different for 0, `user_id` null for 0.
  - t07 and t16 each have `id == user_id`.
  - `voice_explanations`: 105 of 109 `storage_path` values start with `student_id/`. Of the other 4:
    - 3 are `fake/...` test fixtures from 2026-09-25.
    - 1 (created 2026-09-29) has a path inside ANOTHER existing student's folder. It is probably one of this week's cross-student isolation test rows, but that is not confirmed. It is reported for the reviewer and has not been touched (no staging data changes).
- **Not verified:**
  - Production data was not queried.
  - The live staging constraint was not read from `pg_constraint`, because there is no read-only path for that. The equality above is shown by the schema file and by all 24 staging rows.

### Also fixed during this round's testing
- Keeping a record aside did not clear its heartbeat. For up to 15 s after a reload, the same browser treated the record as owned by another live tab, and "Save it to this work" silently did nothing. The F6c test failed intermittently because of this, and it reproduced 3 times in 6 runs. Keep-aside and "Save it to this work" now clear the heartbeat. New check F6e covers it, and F6c then passed 6 of 6.
- Two older tests assumed the pre-R4-1 behaviour. "Stored, but the answer was lost" (F5c) and "reload while an already-stored upload's answer is pending" (F5f) now complete by themselves through the existence check. L3 now waits until the upload has really started, as H8 does.

### Test results (round 5, actually executed)
- Unit: 75/75. Includes the full `voiceLifecycle.test.ts`, with R4-1 status tables and the R4-2 before/after calculation, and R4-3 in `voiceRound4.test.ts`.
- `tsc`: clean. ESLint on the 7 changed files: 0 problems. Full repo: 286 errors / 16 warnings (unchanged baseline).
- Build: OK. `dist` contains no `__setSessionForTests`, `voice-modal-harness` or `__harness`.
- Browser harness, queued path: 85/85, run twice back to back on the final code.
- Browser harness, non-queued path: 8/8.
- Real task page: 13/13, run twice.
- The new tests on the previous code (024c8d5, with only the new test script added):
  - Queued path: 3/9. R4-2b A=5 s; R4-1a/R4-1b a 502 was treated as final, the record was deleted and nothing was enqueued; R4-3 failed; F6e/F6c heartbeat failed.
  - Non-queued path: S5c A=5 s.
- Staging counts identical before and after.
- R4-3 suspension is REAL script suspension (the page's JavaScript paused through the DevTools debugger, so no timers or heartbeat) in a real second tab, with real waiting (16.5 s). Chromium's `Page.setWebLifecycleState 'frozen'` is ignored for a visible headless page (probe: timers kept running), so it was not used. The upload request stayed open in the browser throughout.
- Simulations elsewhere: the throttled clock, hidden-tab visibility, the decoded audio length, delayed recorder events (a MediaRecorder subclass queues them), the crashed holder (a clock 20 s ahead), and every network write (faked).

## Lifecycle round 6 (round-5 audit N1, N2; N3 documented)

Browser code only. No SQL, migrations, deployment, production configuration or staging row changes.

| Item | Change |
|---|---|
| N1 premature removal across tabs | "Remove from this list" deletes a kept-aside record's local details only when "Check" has confirmed that the server holds a job for this very recording (`mayForgetRecord`: "saved" or "saved-elsewhere"). Otherwise it only hides the entry (`dismissed: true`), and the record stays in browser storage. The cases are: never checked; no row; the check failed; or a heartbeat that merely went quiet. If the tab that owns it later stores the upload, the entry comes back (`markStored` clears `dismissed`). If that tab later fails and is closed, the record remains. A heartbeat is never treated as proof of anything. |
| N2 kept-aside ownership | `asideStatus` decides "Check". "saved" requires the row's student, task, proof, storage path and key (when set) to all match the record (`rowMatchesMarker`). The other results: same recording but other or unrecorded work gives "saved-elsewhere" (its own wording, no "save here"); a row that is not this recording gives "conflict"; a failed check gives "unknown" (inconclusive); and "none" is used only for a genuine "no row". "Save it to this work" asks the server again first, and never attaches the recording when a job for it now exists. |
| N3 insert guard | Documented only: `docs/STEP6-BACKEND-PROPOSALS.md` has the exact guard text and six required tests. Nothing was applied. |

### Before and after (the same new tests)
- Before the fix (fa8a183): browser N1/N2 **4/13** passed.
  - N1: the record was deleted (0 left), including after the tab's upload failed and it was closed.
  - N2: rows for another proof, another task or a different key were all shown as "saved on the server".
  - N2: a job completed elsewhere was still attached by "Save it to this work".
  - The 4 passes are the keep-working checks: full match, failed check, and delete after a confirmed save.
- Unit `voiceRound6.test.ts` before the fix: failed (the helpers did not exist).
- After the fix: browser N1/N2 **13/13**, unit **4/4**.

### 17-check release status (evidence-based; not a production approval)
The statuses start from the round-5 audit's table. Round 6 changes the evidence for checks 3, 4 and 11 at the mocked-browser/code level only.

| # | Check | Status | Round-6 evidence / what remains |
|---|---|---|---|
| 1 | Recording duration | Partial | Per-recorder clock with mocked tests; real Safari/mobile and a server-side length limit remain. |
| 2 | Upload reliability | Partial | Transient-error handling with mocked tests; real flaky networks and concurrent PUTs remain. |
| 3 | Recovery | Partial (N1/N2 corrected, mocked) | Two real tabs, one suspended: Remove no longer deletes; ownership-checked "Check". Real upload/enqueue crash recovery remains. |
| 4 | Multiple tabs | Partial (N1 corrected, mocked) | Debugger-paused tab plus a real 16.5 s wait. True OS/browser tab freezing remains untested. |
| 5 | Microphone lifecycle | Partial | Mocked device only; real devices and permissions remain. |
| 6 | Playback | Code-level accepted | Real stored-file replay and expired tokens remain. |
| 7 | Authentication | Unverified end-to-end | Real Google sessions, token refresh, a timed account switch, RLS. |
| 8 | Student isolation | Partial | Folder rule plus earlier staged access tests; the N3 guard is proposed, not applied. |
| 9 | Consent | Partial | Mocked; real-session persistence remains. |
| 10 | Score integrity | Code-level accepted | The real worker → score → PDF chain remains. |
| 11 | Data ownership | Partial (N2 corrected, mocked) | Full-row checks now also cover kept-aside records. N3 and live RLS tests remain. |
| 12 | Processing performance | Unverified | No latency measurements. |
| 13 | Concurrency / load | Unverified | No approved load run. |
| 14 | Rate limits | Unverified | Not measured. |
| 15 | Failure monitoring | Unverified | Alerts and traces for these flows not validated. |
| 16 | AI operating costs | Unverified | Not measured for this flow. |
| 17 | Operational security | Partial | The production-build hook check was re-run this round; deployed triggers and scheduler secrets remain. |

Count: 2 code-level accepted, 9 partial, 6 unverified. The same counts as the round-5 audit: N1/N2 are corrected but only mock-verified, so no check moves to "accepted".

### Round 6 test results (actually executed, on the final code)
- Unit, 7 files including `voiceRound6.test.ts`: 79/79, 0 skipped.
- `tsc`: clean.
- ESLint: 0 problems on the 4 changed code files. The full repo is 286 errors / 16 warnings (unchanged baseline).
- Build: OK. `dist` contains no test hook and no leftover `import.meta.env.DEV`.
- Test-hook runtime check: production build INERT, dev server ACTIVE (the control).
- Browser harness, queued path: 98/98, run twice back to back.
- Browser harness, non-queued path: 8/8 twice. N1/N2 do not apply there: that path keeps no recovery or kept-aside records.
- Real task page: 13/13 twice.
- Staging counts identical before and after.
- **Failures met during this round (logs kept in the review package):**
  1. First full queued runs, 97/98 twice: F6d. That test still expected an unchecked "Remove" to delete the record, which is exactly what N1 forbids. Its expectation was updated: the entry is hidden and its record kept.
  2. A later queued run, 97/98: F3c, intermittent (1 in 8 when repeated). Diagnosis: the harness's two quick prop changes (unmount, then mount) were sometimes merged by React, so no unmount happened. A test-only fix waits until the dialog has really gone; every close-then-reopen now uses it. F3c then passed 15 of 15.
  Neither failure was a product-code defect.

## Lifecycle round 7 (round-6 review items; read-only system audit)

**The Round 6 audit file was not available on this machine.** This round implements the four items
exactly as listed in the task. The read-only system audit, the diagnostic map, the confirmed mismatches
and the real staging test plan are in `docs/STEP6-ROUND7-SYSTEM-AUDIT.md`.

| Item | Change |
|---|---|
| R6-1 hidden records unreachable after the owning tab fails or closes | Entries hidden with "Remove" (no confirmed server job) are listed under "Show hidden recordings (N)". Each can be checked, saved to this work, shown in the list again, or deleted once "Check" confirms a server job. No record is left without a screen. |
| R6-2 same-tab unsent audio lost on Remove | "Remove" without a confirmed job only hides the entry and **keeps** this page's unsent audio (and the leave-page warning), so it can still be checked and saved from "Hidden". Only a confirmed job lets the local record and audio go. |
| R6-3 NULL key / path rules; ambiguous reused paths | Path lookups ask for up to 2 rows (`findRowsByPath` + `pickUnique`): 0 means none, 1 means that row, 2 or more means **"ambiguous"**. An ambiguous path never identifies a recording (never "saved", no "save here", older records unresolved). The rules are written in `asideStatus`: a key that is set must equal the record's key; a path that is set must equal it; a NULL row key can be matched only by a path that exactly one row uses. |
| Proposal path-validation error | `docs/STEP6-BACKEND-PROPOSALS.md`: the round-6 pattern accepted `<id>/..`, `.`, `.hidden` and `a..b.webm`. It is corrected and checked against 16 cases, and the required tests are extended. Still not applied. |

### Before and after (same new tests)
- On the unfixed code (25a26e5): browser **3/8**. R6-1, R6-2a, R6-2b, R6-3a and R6-3b failed; the three N1 keep-working checks passed.
- After the fix: **8/8**. New unit file `voiceRound7.test.ts`: 6/6.

### Round 7 test results (actually executed, final code)
- Unit, 8 files: **85/85**, 0 skipped.
- `tsc` clean. ESLint on the changed files: 0 problems (full repo 286 / 16, unchanged).
- Build OK. The hook is INERT in a production build and ACTIVE on the dev server (control).
- Queued harness: **103/103** twice. Non-queued: **8/8** twice. Task page: **13/13** twice.
- Staging counts identical before and after (the one inspection run was read-only).
- No failures or skipped tests in the final runs.
