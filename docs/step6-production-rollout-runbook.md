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
- **`PGRST_JWT_SECRET` is not `WEBHOOK_SECRET`.** Step 6H's draft of step 6
  (worker deployment) said the worker's `PGRST_JWT_SECRET` should come
  from "the freshly rotated, step 3 production secret" — step 3 rotates
  `webhook-secret` only. That sentence would have pointed the worker's
  database-authentication secret at the wrong Secret Manager entry
  entirely. Corrected in step 6 below: the worker's `PGRST_JWT_SECRET`
  is `prooflab-jwt-secret`, a completely different secret that this
  rollout does not rotate and step 3 never touches. Rotating
  `webhook-secret` must never change what the worker signs its own
  PostgREST tokens with.
- **Migration 01 (the staging compat layer) must never run against
  production.** It bootstraps `auth`/`anon`/`authenticated`/`service_role`
  and a permissive baseline `GRANT ALL` from nothing, for a database
  rebuilt from a schema-only dump with `auth` excluded — that is staging's
  situation, not production's. Production has served real traffic under
  this same role/JWT model the whole time migration 41 assumes, which
  means the roles and baseline grants migration 01 creates from scratch
  already exist there, from whatever originally stood the database up.
  Migration 41's actual dependency is "these roles and functions already
  work," verified below, not "migration 01 has run" — it has not, and
  should not.
- **Actual production roles/grants were not fully verifiable read-only.**
  Confirmed via ordinary read traffic (real GETs, which production already
  serves) that `anon`/`authenticated`/`service_role` function as expected
  for reads. What could **not** be safely confirmed without risking an
  actual write is whether `authenticated` currently holds an overly broad
  table-level `UPDATE` on `voice_explanations` in production — the exact
  baseline-grant shape that made migration 43's column-level revoke
  ineffective in staging (Step 6C) and had to be fixed with a table-level
  one instead. This determines whether migration 42's revoke will actually
  take effect in production or needs the same table-level correction.
  **Action required before step 2**, using a real (human-supervised)
  `psql` session, not PostgREST: run
  `select has_table_privilege('authenticated', 'public.voice_explanations', 'UPDATE');`
  and confirm the answer, or run
  `select grantee, privilege_type from information_schema.role_table_grants where table_name='voice_explanations';`
  and read the actual grant shape. If `authenticated` has table-level
  `UPDATE`, migration 42 must be adjusted the same way migration 43 was in
  staging before this rollout proceeds.

## 1. Migration dependency order (41 → 46)

Actual dependencies, verified by reading each file, not assumed from
numbering:

| # | Adds | Depends on |
|---|---|---|
| 41 | `transcription_status` and friends on `voice_explanations`; `claim/complete/fail_transcription_job` | Working `anon`/`authenticated`/`service_role` roles and baseline grants already existing in production (not migration 01 — see §0) |
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
`QUEUE_MAX_ATTEMPTS=3`. `PGRST_JWT_SECRET` is `prooflab-jwt-secret` — the
existing database-signing secret every other production service already
uses, untouched by and unrelated to step 3's `webhook-secret` rotation
(see §0). Do not point this at anything step 3 rotates.
`--no-allow-unauthenticated`, the step 4 SA.

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

`VITE_ASYNC_TRANSCRIPTION` is a **build-time** Vite env var — confirmed
empirically across Steps 6E/6G by grepping built output: with it set, the
async code path's strings (`transcription-enqueue`, the "Uploading your
recording…" UI text) are compiled into the bundle; with it unset, they are
not. One build has exactly one value, for every visitor of whatever URL
serves that build. **A single real production account cannot be switched
to the async path by itself while sharing the main production URL with
everyone else** — there is no per-account runtime check anywhere in the
current code, only this one build-time constant. Do not attempt a
"canary" by editing `.env.production` and redeploying the main site: that
flips the flag for every current production user simultaneously, which is
exactly what a canary is meant to avoid.

Production's frontend deploys via Firebase Hosting (`scripts/deploy-hosting.py`,
site `prooflab-508214`). Firebase Hosting's own **preview channels**
(`firebase hosting:channel:deploy <channel-id>`) publish to a separate,
temporary URL without touching the live site's traffic at all — this is
the real isolated-canary mechanism, available today with no code change:

1. Build once with `VITE_ASYNC_TRANSCRIPTION=true` and every other
   `.env.production` value unchanged (real production backend URLs — a
   canary tests the real pipeline, not staging's).
2. Deploy that build to a preview channel, not the live site.
3. Give the channel's own URL to the one real account (or small cohort)
   running the canary. Everyone else continues using the unchanged main
   production URL/build, still flag-off.
4. Retire the channel (`firebase hosting:channel:delete`) once the canary
   concludes, whether it succeeds or is abandoned.

This isolates by URL, not by account identity — the canary participant
must actually be given and use the channel URL rather than the normal one.
That is a real, if manual, isolation boundary; a proper per-account runtime
flag (a column checked at app load, replacing or supplementing the
build-time constant) would be the scalable version of this, and is a
Step 7-sized change, not part of this rollout.

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

Using step 9's preview-channel build, run the canary for at least one
full day with the one real low-stakes account (or the smallest real
cohort the product owner accepts) actually using that channel's URL.
Watch every metric in step 10. Do not widen the cohort — by adding more
people to the same channel, then eventually flipping the flag on the main
site — until a full day has produced zero unexplained stuck jobs and zero
worker error-rate spikes.

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
- Production frontend deploys via Firebase Hosting (`scripts/deploy-hosting.py`,
  site `prooflab-508214`), not a Cloud Run service — relevant to how the
  canary in §9/§11 is actually isolated.
- Whether `authenticated` holds table-level `UPDATE` on production's
  `voice_explanations` was **not** determined this session — it needs a
  real `psql` session, not a read-only REST probe (see §0). This is the
  one open fact-finding item before step 2.
