#!/usr/bin/env bash
# Apply one SQL file to the REAL database through the REAL SQL runner job
# (prooflab-sql-runner: psql with prooflab-db-uri). Only with the owner's yes for that change.
#   scripts/dev-tools/real_sql.sh migration/NNN-....sql
# The exit code is the job's exit code (psql runs with ON_ERROR_STOP). The printed log lines are THIS
# execution's own (named from the execute call), never "the newest run of the job", which another caller
# may have started meanwhile. The SQL is gzip-compressed so larger files fit in the job's argument limit.
set -euo pipefail
P=prooflab-508214; R=asia-south1; F="$1"
SCRIPT=$( { echo 'set -e'; echo "psql \"\$DB_URI\" -v ON_ERROR_STOP=1 <<'SQLEOF'"; cat "$F"; echo 'SQLEOF'; } | gzip -9 | base64 -w0 )
set +e
EX=$(gcloud run jobs execute prooflab-sql-runner --region=$R --project=$P --wait --format="value(metadata.name)" \
       --args="-c,echo $SCRIPT | base64 -d | gunzip | bash" 2>/tmp/real_sql_err.$$)
CODE=$?
set -e
[ -n "$EX" ] || EX=$(grep -oE "prooflab-sql-runner-[a-z0-9]+" /tmp/real_sql_err.$$ | tail -1 || true)
[ "$CODE" -eq 0 ] || tail -3 /tmp/real_sql_err.$$ >&2
rm -f /tmp/real_sql_err.$$
if [ -n "$EX" ]; then
  sleep 20
  gcloud logging read "resource.type=cloud_run_job AND labels.\"run.googleapis.com/execution_name\"=$EX" --project=$P --freshness=30m --format="value(textPayload)" --order=asc | grep -v '^$' | tail -8 || true
fi
echo "real_sql exit=$CODE (${EX:-execution unknown})"
exit $CODE
