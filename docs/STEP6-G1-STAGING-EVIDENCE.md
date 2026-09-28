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
