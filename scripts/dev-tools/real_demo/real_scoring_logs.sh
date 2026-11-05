#!/usr/bin/env bash
# Read-only: did season scoring already fail on REAL? Reads job logs and season counts. Changes nothing.
source "$(dirname "$0")/lib.sh"
f=$(mktemp)
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="prooflab-functions" AND (jsonPayload.message:"scheduled-job weekly-seasons" OR jsonPayload.message:"scheduled-job extend-fixtures")' \
  --project=$P --freshness=40d --order=asc --format='value(timestamp,jsonPayload.message)' > "$f"
echo "JOB_RUNS_READ: $(wc -l < "$f")"
echo "FIRST_READ: $(head -1 "$f" | cut -c1-20)"
echo "LAST_READ: $(tail -1 "$f" | cut -c1-20)"
echo "BLOCKED_BY_ROW_RULE: $(grep -c 'row-level security' "$f" || true)"
echo "OTHER_FAILED: $(grep -v 'row-level security' "$f" | grep -cE 'failed|"ok":false' || true)"
grep -E 'row-level security|failed|"ok":false' "$f" | cut -c1-260 | sed 's/^/FAILURE: /' | head -40 || true
rm -f "$f"
real_read "$HERE/sql/scoring_history.sql" | grep -E '^(PAST_WEEK|GRANTS): |exit=|ERROR'
