#!/bin/bash
# COPY FOR READING (11 Nov 2026). Run the original at scripts/dev-tools/real_demo/ - see scripts/demo/README.md.
# Owner-run. Switches on "Companies can see my profile" for the 12 QA Demo students on REAL (demo only).
source /c/Users/manit/prooflab-sec-gate/scripts/dev-tools/real_demo/lib.sh
real_write "$(dirname "$0")/sql/demo_visible.sql" && echo "write: OK" || echo "write: FAILED - nothing was changed"
