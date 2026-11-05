#!/usr/bin/env bash
# Moves ONLY the ProofLab QA Demo season forward one week, then prints the new week and standings.
#   bash scripts/dev-tools/real_demo/real_next_week.sh
# Before running: finish today's Lots (with voice). A Lot left open counts as missed once the week moves on.
source "$(dirname "$0")/lib.sh"
real_write "$HERE/sql/next_week.sql"
real_read "$HERE/sql/standings.sql" | grep -E '^(WEEK|STANDING|MATCH|CHAMPION): |exit='
