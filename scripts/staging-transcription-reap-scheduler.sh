#!/usr/bin/env bash
# Reproduces prooflab-staging-transcription-reap, the Cloud Scheduler job that
# drives automatic recovery for the async transcription pipeline (Step 6C/6D).
# Staging only - there is no production equivalent of this job.
#
# The webhook secret is read from Secret Manager at run time and passed only
# as a live process argument; it is never written to this file, to disk, or
# to any log this script produces. Run it after prooflab-staging-webhook-secret
# is rotated to re-point the scheduler at the new value - the job's config
# does not update itself when the secret changes.
#
# Usage: ./scripts/staging-transcription-reap-scheduler.sh
set -euo pipefail

PROJECT="prooflab-508214"
LOCATION="asia-south1"
JOB="prooflab-staging-transcription-reap"
FUNCTIONS_URL="https://prooflab-staging-functions-135298577404.asia-south1.run.app"

# Every minute: a third of the pipeline's 180s stale-lease window, so a
# genuinely stuck job is never more than ~1 minute from its first recovery
# attempt. See migration/43-transcription-durable-recovery.sql for why the
# recovery itself is safe to call this often (bounded, TTL'd, idempotent).
SCHEDULE="* * * * *"

SECRET="$(gcloud secrets versions access latest \
  --secret=prooflab-staging-webhook-secret --project="$PROJECT")"

if gcloud scheduler jobs describe "$JOB" --project="$PROJECT" --location="$LOCATION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" \
    --project="$PROJECT" --location="$LOCATION" \
    --schedule="$SCHEDULE" \
    --uri="${FUNCTIONS_URL}/transcription-reap" \
    --http-method=POST \
    --headers="Content-Type=application/json,x-webhook-secret=${SECRET}" \
    --message-body="{}" \
    --time-zone="Asia/Kolkata" \
    --attempt-deadline=60s \
    >/dev/null
  echo "updated $JOB"
else
  gcloud scheduler jobs create http "$JOB" \
    --project="$PROJECT" --location="$LOCATION" \
    --schedule="$SCHEDULE" \
    --uri="${FUNCTIONS_URL}/transcription-reap" \
    --http-method=POST \
    --headers="Content-Type=application/json,x-webhook-secret=${SECRET}" \
    --message-body="{}" \
    --time-zone="Asia/Kolkata" \
    --attempt-deadline=60s \
    >/dev/null
  echo "created $JOB"
fi

unset SECRET
