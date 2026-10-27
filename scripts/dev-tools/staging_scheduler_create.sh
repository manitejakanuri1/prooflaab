#!/usr/bin/env bash
# TEST website only: creates the season/squad jobs the REAL website has (infra/staging/scheduler.json).
# Season jobs run every minute so the short testing week moves on time. Run once:
#   bash scripts/dev-tools/staging_scheduler_create.sh
set -u
U=https://prooflab-staging-functions-ysn2mpe6sa-el.a.run.app
SA=prooflab-staging-scheduler@prooflab-508214.iam.gserviceaccount.com
for j in "weekly-seasons|* * * * *" "extend-fixtures|* * * * *" "nightly-squads|35 5 * * *" \
         "weekly-progress|45 23 * * 0" "weekly-plan|0 8 * * 1"; do
  n=${j%%|*}
  gcloud scheduler jobs create http "prooflab-staging-$n" \
    --location=asia-south1 --project=prooflab-508214 \
    --schedule="${j#*|}" --time-zone=Asia/Kolkata \
    --uri="$U/scheduled-job?job=$n" --http-method=POST \
    --oidc-service-account-email="$SA" --oidc-token-audience="$U" \
    --attempt-deadline=320s --format="value(name.basename(),schedule,state)"
done
