#!/bin/bash
# Owner-run (Purna), READ ONLY on REAL: lists the stage61 demo-fixture rows. Changes nothing, deletes nothing.
source /c/Users/manit/prooflab-sec-gate/scripts/dev-tools/real_demo/lib.sh
real_read "$(cd "$(dirname "$0")" && pwd)/sql/stage61_list.sql" | grep -E '^[A-Z_]+: |exit='
