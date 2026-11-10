#!/bin/bash
# Owner-run, READ ONLY on REAL. Uses the unchanged lib at the old path.
source /c/Users/manit/prooflab-sec-gate/scripts/dev-tools/real_demo/lib.sh
real_read "$(cd "$(dirname "$0")" && pwd)/sql/precheck_scope.sql" | grep -E '^SCOPE: |exit='
