#!/usr/bin/env bash
# Read-only: shows the demo's current week and who owns the scoring functions and tables. Changes nothing.
source "$(dirname "$0")/lib.sh"
real_read "$HERE/sql/standings.sql" | grep -E '^(WEEK|STANDING|MATCH|CHAMPION): |exit='
real_read "$HERE/sql/scoring_owner_check.sql" | grep -E '^(RUNNER|TABLE|FUNCTION|POLICY|NOT_OWNED_BY_SCORING|SEASONS_ACTIVE): |exit='
