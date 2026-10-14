# ProofLabAI production architecture (live, 1 Oct 2026)

Built from live reads on 1 Oct 2026 (`gcloud run services list`, `gcloud sql instances describe`,
`gcloud scheduler jobs list`, `gcloud tasks queues describe`, Firebase Hosting release list). Supabase
and Vercel are retired; any document that says otherwise is historical.

Project `prooflab-508214`, region `asia-south1` (Mumbai). Site: https://prooflab.co.in

## 0. Update - release 444b2f3 + closure (verified live 7 Oct 2026; main `d814d5d`)

The sections below are from 1 Oct. What changed with the release and the 7 Oct production closure:

| Area | Live now |
|---|---|
| Functions | image `prooflab-functions:prod-444b2f3`; `CODE_RUNNER_AUTH=iam`, `CODE_RUNNER_URL` = the dedicated runner below. `CODE_RUNNER_SECRET` is still set (unused with `iam`; removal is a later step). |
| Code runner | own project `prooflab-runner-508214`, service `prooflab-code-runner-rc` (image `code-runner:prod-444b2f3`): Cloud Run IAM, callers = the functions robots only, no secret, no data. The old `prooflab-code-runner` in the main project still exists (public + `RUNNER_SECRET`) as the rollback; retire it later. |
| Coding tasks | two kinds (migration 92, `task_sandbox_config.kind`): `stdio` (whole program, stdin/stdout - the old path, unchanged) and `function` (student implements one function; `function_spec` frozen with the tests; arguments are canonical JSON sent to the runner on stdin; a trusted per-language harness calls the function and returns the value in a result frame). Verdicts include `output_limit`. |
| Scheduler | daily jobs at their normal times again: nightly-squads 05:35, extend-fixtures 05:37, daily-lots 05:40 IST. |
| Hidden tests | Run uses visible tests only. Submit returns and stores visible rows plus ONE `hidden-summary` row (counts only: no hidden inputs, outputs, errors or ids). The pass rule counts that row as its `hidden_count` tests (migration 93, applied 7 Oct). |
| API | `PGRST_DB_PRE_REQUEST=public.refuse_suspended`: a suspended account is refused at once. |
| Images | every other service is deployed by digest (`docs/RELEASE-MANIFEST.md`). |
| Shared secrets | `WEBHOOK_SECRET` (secret version 2 since 7 Oct; version 1 disabled) on functions + accounts - the 9 Scheduler jobs send it; the Google-identity replacement (F7) is prepared on branch `work/post-release`, not on main and not switched on. `PGRST_JWT_SECRET` on api, auth-bridge, files, functions, transcriber, worker, accounts and the crawler/bug-finder jobs (single-signer F1 not yet in production). |
| Migrations | ledger `schema_migrations`: 45 files (50-93) applied; 66, 71, 72 and 94 (permanent drops) prepared, not applied. |

## 1. Whole system

```
                        Browser (student / college / company / admin)
                                         |
                    https://prooflab.co.in  (Firebase Hosting, static React build,
                                         |    security headers from scripts/deploy-hosting.py)
          +------------------+-----------+-----------+------------------+-------------------+
          |                  |                       |                  |                   |
   Identity Platform   prooflab-auth-bridge     prooflab-api       prooflab-functions   prooflab-files
   (Google login,      (Google ID token ->      (PostgREST v16,    (40 Deno functions,  (signed private
    email+password)     app JWT)                 row-level          DeepSeek AI)          file access)
                                                 security)              |
                                                     |                  +--> prooflab-code-runner (Run button, sandbox)
                                                     |                  +--> Cloud Tasks prooflab-transcription
                                                     v                           |
                                          Cloud SQL prooflab-db                   v
                                          (Postgres 17)  <-------------- prooflab-transcription-worker (private)
                                                     ^                           |
                                                     |                           v
                                          prooflab-accounts               prooflab-transcriber (Whisper)
                                          (login sync / removal)
   Cloud Scheduler (13 production jobs) --> functions scheduled jobs, reaper, accounts sync, bug-finder, crawler
   Cloud Monitoring alerts --> email channel ; Billing budget Rs 3,000 (50/80/100 %)
```

## 2. Services (live revisions)

| Service | Revision | Runs as | Max instances | Requests per instance | Who can call |
|---|---|---|---|---|---|
| prooflab-api (PostgREST v16.3, DB pool 4) | 00003-n6c | default compute SA | 4 | 80 | public; app JWT decides rows |
| prooflab-functions (40 Deno functions) | 00052-g84 | default compute SA | 4 | 80 | public; each function checks login |
| prooflab-auth-bridge | 00011-njh | default compute SA | 3 | 80 | public; needs a valid Google ID token |
| prooflab-files | 00013-jsz | default compute SA | 4 | 80 | public; app JWT decides objects |
| prooflab-accounts | 00002-bc9 | default compute SA | 2 | 80 | public; needs service/admin token |
| prooflab-transcriber (Whisper) | 00002-8lk | default compute SA | 3 | 1 | public; needs app login (mock interview + worker) |
| prooflab-code-runner | 00001-rpr | `code-runner` SA | 6 | 1 | public; needs runner secret |
| prooflab-transcription-worker | 00001-sl6 | `prooflab-transc-wk` SA | default | 80 | private; only `prooflab-tasks-invoker` (Cloud Tasks) |

Jobs: `prooflab-bug-finder`, `prooflab-crawler` (production); `prooflab-staging-inspect4` (staging SQL access).
The "default compute SA" still holds project Editor — see gap G05 and `docs/closure/OWNER-COMMANDS.md` section 8.

## 3. Database

| Item | Value |
|---|---|
| Instance | `prooflab-db`, Postgres 17, db-g1-small, ZONAL (single zone, no automatic failover) |
| Backups | daily at 20:00 UTC, 7 kept; point-in-time recovery on, 7 days of logs |
| Protection | deletion protection on |
| Measured load (7 days) | CPU max 17.8 %, memory median 43.6 % (one 91 % spike during migration work), max 7 connections, 0 deadlocks, disk 0.3 GB |
| Staging | `prooflab-staging-db` (db-f1-micro), separate instance |

## 4. Login flow

```
Browser --Google or email/password--> Identity Platform --ID token--> prooflab-auth-bridge
       <--app JWT (role, user id)------------------------------------------'
Browser --app JWT--> prooflab-api / prooflab-functions / prooflab-files
PostgREST switches to role "authenticated"; row-level security + security-definer RPCs decide what is visible.
```

## 5. Student written/sandbox task

```
Daily card -> task page -> (optional scratchpad Run: functions run-code -> code-runner, nothing saved)
          -> Submit: functions submit-written-task / submit-sandbox-task
             -> DeepSeek grading (written) or every test on the dedicated runner
                (sandbox: stdio program or function harness; Cloud Run IAM, no secret)
             -> record_task_submission (server-only RPC) -> task_submissions row -> Build-Log
DeepSeek down: written grading answers "busy" (503), student retries; nothing is lost.
```

## 6. Voice explanation (async)

```
Browser records -> prooflab-files (private bucket voice-explanations/)
               -> functions transcription-enqueue -> voice_explanations row (pending) + Cloud Task
Cloud Tasks prooflab-transcription (2 at once, 1/s, 3 attempts)
               -> prooflab-transcription-worker (private) -> prooflab-transcriber (Whisper)
               -> transcript -> DeepSeek scoring -> status "scored" -> Build-Log shows score
Reaper: Cloud Scheduler prooflab-transcription-reap every minute -> functions transcription-reap
        re-queues stuck rows, fails rows after 8 recovery attempts with an alert.
Measured on staging: 10 recordings drained in 45 s (~13/min).
```

## 7. Mock interview (direct transcriber)

```
Browser -> prooflab-transcriber /transcribe (app login required, 15 MB cap, 1 request per instance, max 3)
```

## 8. Files and storage

| Bucket | Use | Access |
|---|---|---|
| prooflab-private-508214 | proofs, voice audio | private; only through prooflab-files with an app JWT |
| prooflab-public-508214 | public images | objects readable; anonymous listing refused (fixed 1 Oct) |
| prooflab-backups-508214 | SQL exports | private |
| prooflab-staging-private/public-508214 | staging | staging only; public-access prevention on staging private |

All buckets: uniform bucket-level access, 7-day soft delete (deleted files can be recovered for 7 days).
No lifecycle rules: proofs and voice audio are kept until a student is removed. Backups bucket and private bucket enforce public-access prevention.

## 9. Scheduled jobs (production, all ENABLED)

| Job | Schedule (UTC) |
|---|---|
| prooflab-transcription-reap | every minute |
| prooflab-accounts-sync | every 10 min |
| prooflab-prune-events | 03:10 daily |
| prooflab-bugfinder-deep-run | 04:00 daily |
| prooflab-nightly-squads | 05:35 daily |
| prooflab-extend-fixtures | 05:37 daily |
| prooflab-daily-lots | 05:40 daily |
| prooflab-bugfinder-run | 06/10/14/18/22:00 |
| prooflab-weekly-plan | Mon 08:00 |
| prooflab-crawler-weekly | Sun 08:10 |
| prooflab-weekly-seasons | Sun 23:30 |
| prooflab-weekly-progress | Sun 23:45 |

(`prooflab-staging-transcription-reap` is staging.)

## 10. Release path

```
branch -> merge to main (owner says yes) -> GitHub Actions deploy.yml
          job "test": npm ci, unit tests, typecheck, Deno tests, build  --fail--> nothing deploys
          job "deploy" (needs test): build -> Firebase Hosting release
Functions/API/worker images: built and deployed by hand per docs/step6-production-rollout-runbook.md,
staging first. Database: SQL files in migration/, applied by hand with a backup first.
```

## 11. Monitoring

- Email notification channel active; all policies auto-close after 24 h.
- Policies include: production 5xx (staging services excluded), "[P1] AI provider failing",
  "[P2] Voice queue backlog (prooflab-transcription)" (more than 20 waiting for 15 min), scheduled-job failures.
- Budget Rs 3,000 with alerts at 50 %, 80 %, 100 %.
- `scripts/healthcheck.py` (24 checks), `scripts/dev-tools/attack_surface_check.py` (66 checks),
  bug finder (Cloud Run job, 5 runs a day).

## 12. Capacity (staging load test, staging is about half of production)

| Test | Result |
|---|---|
| Browse, 50 users at once | p95 1.2 s, 0 errors |
| Browse, 100 users at once | p95 3.3 s, 1 error |
| Browse, 200 users at once | p95 5.2 s, 0.3 % timeouts (stopped) |
| Run button, 40 at once | p95 0.7 s, 105 runs/s, 0 busy |
| Voice, 10 recordings | all scored in 45 s |

Safe for the current pilot. Not highly available: a zone outage of the database stops the site until
it is restored (see docs/DISASTER-RECOVERY-RUNBOOK.md).
