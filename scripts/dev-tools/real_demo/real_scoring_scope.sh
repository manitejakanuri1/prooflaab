#!/usr/bin/env bash
# Read-only: lists which functions the owner mismatch can block, the active seasons, and who uses prooflab_app. Changes nothing.
source "$(dirname "$0")/lib.sh"
real_read "$HERE/sql/scoring_scope.sql" | grep -E '^(WRITES|SEASON|ROLE|MEMBER|CONNECTED): |exit=|ERROR'
