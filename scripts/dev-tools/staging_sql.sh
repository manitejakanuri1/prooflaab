#!/usr/bin/env bash
# Apply one SQL file to the STAGING database through the staging SQL runner job
# (prooflab-staging-inspect4: psql with prooflab-staging-db-uri). Never production.
#   scripts/dev-tools/staging_sql.sh migration/55-....sql
set -euo pipefail
P=prooflab-508214; R=asia-south1; F="$1"
SCRIPT=$( { echo 'set -e'; echo "psql \"\$STAGING_DB_URI\" -v ON_ERROR_STOP=1 <<'SQLEOF'"; cat "$F"; echo 'SQLEOF'; } | base64 -w0 )
set +e
gcloud run jobs execute prooflab-staging-inspect4 --region=$R --project=$P --wait --args="-c,echo $SCRIPT | base64 -d | bash" > /dev/null 2>&1
CODE=$?
set -e
EX=$(gcloud run jobs executions list --job=prooflab-staging-inspect4 --region=$R --project=$P --limit=1 --format="value(metadata.name)")
sleep 20
gcloud logging read "resource.type=cloud_run_job AND labels.\"run.googleapis.com/execution_name\"=$EX" --project=$P --freshness=30m --format="value(textPayload)" --order=asc | grep -v '^$' | tail -8
echo "staging_sql exit=$CODE ($EX)"
exit $CODE
