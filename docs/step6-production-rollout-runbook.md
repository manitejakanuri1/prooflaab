# Step 6 production rollout runbook

Status: **not executed**. This is a checklist to follow when a production
rollout of the async transcription pipeline (Step 6B–6H) is explicitly
approved. Every fact below comes from read-only inspection of production
during Step 6G/6H — nothing in this document has been run.

Production and staging are the same GCP project (`prooflab-508214`).
"Production" resources below just means resources without a `staging-`
prefix, in that same project.

## 0. Corrections to the Step 6G draft of this checklist

- **Backup precedes migrations, not the other way round.** Step 6G's draft
  listed "database backup and migration preflight" as its own late item.
  It must run *before* step 2 below, not after it.
- **Webhook-secret rotation precedes scheduler creation, not the reverse.**
  The scheduler's header carries the secret's value at creation time; if
  the secret is rotated afterward the scheduler keeps invoking with the
  now-invalid old value until someone re-runs the equivalent of
  `scripts/staging-transcription-reap-scheduler.sh` for production. Rotate
  first (step 3 below), create the scheduler after (step 8).
- **Migration 40 is not a dependency of 41–46.** It touches
  `notifications`/`notify_weekly_progress` only — nothing in 41–46
  references that table or function. Its numerical position is
  coincidental, not a dependency signal. It can ship on its own schedule;
  it is listed here only because Step 6G's draft wrongly implied it
  blocked this rollout, and that needed correcting on the record, not
  because this rollout needs it.
- **Production transcriber capacity is not "load-tested."** Its current
  config (2 CPU, 2Gi memory, maxScale 3, concurrency 1) happens to match
  staging's. That is a coincidence of both having been sized the same way
  originally, not evidence it has been exercised under the load this
  feature will add. Capacity planning (step 10) must treat it as
  unvalidated until the canary (step 11) actually produces data.

## 1. Migration dependency order (41 → 46)

Actual dependencies, verified by reading each file, not assumed from
numbering:

| # | Adds | Depends on |
|---|---|---|
| 41 | `transcription_status` and friends on `voice_explanations`; `claim/complete/fail_transcription_job` | Migration 01 (compat layer roles) only |
| 42 | Lease-token columns/fencing on the 41 functions; table-level `UPDATE` revoke | 41 (alters its columns and functions) |
| 43 | `claim_transcription_recovery`; `guard_voice_explanations_insert` trigger | 41, 42 (reads/writes 42's columns; the trigger forces values in columns 41/42 added) |
| 44 | `scoring_claimed_at`; `claim_voice_scoring` (timestamp-only) | None of 41–43 — independent column/function on the same table |
| 45 | `scoring_lease_token`; rewrites `claim/complete/fail_voice_scoring` with fencing | 44 (replaces its function, extends its column) |
| 46 | `recruiter_talent`/`recruiter_proof_profile` provenance filter | Reads `transcript_source`, which predates all of 41–45 (stage6) — otherwise independent of 41–45, but ships with them since it closes the gap they collectively created |

All six are additive (new columns, new/replaced functions) — none drops or
renames anything an existing production code path reads. `prooflab-functions`
at v37 does not call any of them today, so applying all six in one window,
in this order, is safe with the feature flag left off.

## 2. Pre-migration backup

1. Confirm the most recent automated Cloud SQL backup for `prooflab-db`
   completed successfully (`gcloud sql backups list --instance=prooflab-db`).
2. Take one **on-demand** backup immediately before this window, named so
   it's identifiable (`gcloud sql backups create --instance=prooflab-db
   --description="pre-step6-migrations"`).
3. Confirm point-in-time recovery is enabled on the instance (it should
   already be, for `db-g1-small`) so a mid-window failure can roll back to
   seconds before the first migration, not just to last night's snapshot.

## 3. Webhook secret rotation (separate, explicitly approved change)

**Not part of this rollout's own approval — needs its own sign-off before
step 8.** Affected consumers, all of which must move together:

- Cloud Run services: `prooflab-functions`, `prooflab-accounts`
  (`secretKeyRef` → `webhook-secret`).
- Cloud Scheduler jobs, each carrying the secret in its own header config:
  `nightly-squads`, `extend-fixtures`, `daily-lots`, `weekly-seasons`,
  `weekly-progress`, `weekly-plan`, `prune-events`.

Rotation procedure: same shape as the staging rotation in Step 6D, but
generate the new value via the Secret Manager REST API directly (not
`gcloud secrets versions add --data-file=-` on Windows — that path silently
appended a trailing CR to the staging secret and made it unusable as an
HTTP header; see Step 6D's commit `9ad3489`). Force a new revision on both
services, update all seven scheduler jobs' headers, verify the old version
is disabled and the new one authenticates, before proceeding.

## 4. Service accounts and IAM (new, minimum)

Production currently has no dedicated service account for transcription —
`prooflab-functions` and `prooflab-transcriber` both run on the default
compute service account. Create, resource-scoped only (never a project-level
role):

- `prooflab-transc-wk@prooflab-508214.iam.gserviceaccount.com` — the worker.
  Grants: `roles/storage.objectViewer` on `prooflab-private-508214` only;
  `roles/secretmanager.secretAccessor` on `prooflab-jwt-secret` only.
- A dedicated invoker SA for Cloud Tasks → worker OIDC auth, mirroring
  `prooflab-staging-tasks-invoker`. Grant it `roles/run.invoker` on the
  worker service only.

Do not add either to `prooflab-functions`' or `prooflab-transcriber`'s
existing (default) service account — the worker's identity should be
narrower than what those two already run as, not layered onto them.

## 5. Cloud Tasks queue

Create `prooflab-transcription` in `asia-south1`, same starting config as
staging (`prooflab-staging-transcription`): `maxConcurrentDispatches: 2`,
`maxDispatchesPerSecond: 1`, `maxAttempts: 3`, backoff 5s–30s. Do not widen
these before the canary (step 11) shows headroom — they exist to protect
the transcriber's un-load-tested capacity (see the correction in §0).

## 6. Worker deployment

Deploy the same image already built and proven in staging
(`prooflab-transcription-worker`) to a new production service, env vars
pointed at production's own `POSTGREST_URL`/`TRANSCRIBER_URL`/
`PRIVATE_BUCKET=prooflab-private-508214`, `STALE_AFTER_SECONDS=180`,
`QUEUE_MAX_ATTEMPTS=3`, `PGRST_JWT_SECRET` from the (freshly rotated,
step 3) production secret. `--no-allow-unauthenticated`, the step 4 SA.

## 7. functions-service deployment

Deploy the next `prooflab-functions` revision (current source already has
`transcription-enqueue`/`transcription-reap` registered in `SLUGS`) —
this alone does not expose anything new to students, since the frontend
flag (step 9) stays off. Confirm `/ready` reports all functions loaded
before proceeding.

## 8. Recovery scheduler

Only after step 3's rotation is complete. Create
`prooflab-transcription-reap` in Cloud Scheduler, same script pattern as
`scripts/staging-transcription-reap-scheduler.sh` (adapt the project's
non-staging URLs and queue name), reading the **rotated** secret at
creation time. Verify one real execution succeeds before moving on.

## 9. Feature flag

`VITE_ASYNC_TRANSCRIPTION` stays absent from `.env.production` through
steps 1–8. It is switched on only for the canary (step 11), and only after
every step above has independently verified working.

## 10. Monitoring and alerts

Before the canary:

- Alert on Cloud Tasks dead-letter/permanently-failed task rate > 0 over
  any 15-minute window.
- Alert on the worker's 5xx rate.
- Alert on `reap_stale_transcription_jobs`/`claim_transcription_recovery`
  recovery volume exceeding a small absolute threshold (e.g. > 5/hour) —
  a rising rate means something is genuinely stuck, not just a slow
  DeepSeek call.
- Dashboard: queue depth, worker request latency p50/p95, transcriber
  request latency p50/p95 (this is the number that tells you whether the
  "matches staging" capacity assumption in §0 was actually fine).

## 11. Canary

Flip the flag for a single real low-stakes account, or the smallest real
cohort the product owner accepts, for at least one full day. Watch every
metric in step 10. Do not widen the cohort until a full day has produced
zero unexplained stuck jobs and zero worker error-rate spikes.

## 12. Rollback limits

- **Frontend flag**: instantly reversible — turn `VITE_ASYNC_TRANSCRIPTION`
  back off and redeploy. Always the first rollback action.
- **Migrations 41–46**: additive only, safe to leave applied even with the
  flag off — nothing in the existing (flag-off) code path reads any column
  or function they add.
- **Not safely reversible once jobs are in flight**: deleting the Cloud
  Tasks queue, or dropping/altering any of the new columns, while real
  jobs have been accepted. If a rollback beyond the flag is ever needed:
  disable the flag first, let the queue drain (confirm depth reaches
  zero), *then* consider any further reversal — never the reverse order.
- **Webhook secret rotation (step 3)**: reversible in principle (re-enable
  the old Secret Manager version) but not something to reverse casually —
  treat it as a one-way step once the seven scheduler jobs are confirmed
  working on the new value.

## Appendix: read-only production facts this runbook is based on (Step 6G/6H)

- `voice_explanations` in production has none of migrations 41–46's columns.
- No production Cloud Tasks queues exist.
- `prooflab-functions` and `prooflab-transcriber` run on the default
  compute service account, not a dedicated one.
- `prooflab-functions` is at `v37` (38 functions loaded; does not include
  `transcription-enqueue`/`transcription-reap`).
- Migration 40 (`notifications.dedupe_key`) is also not yet applied —
  independent of this rollout (see §0).
