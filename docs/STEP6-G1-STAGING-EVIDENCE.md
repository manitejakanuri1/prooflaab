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
