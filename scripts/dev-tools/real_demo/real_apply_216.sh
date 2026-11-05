#!/usr/bin/env bash
# Applies migration 216 on REAL as postgres, once, in one transaction. Any failed check undoes all of it.
# real_write adds the transaction, so the file's own begin and commit lines are left out.
source "$(dirname "$0")/lib.sh"
real_write <(grep -vE '^(begin|commit);$' "$HERE/../../../migration/216-season-scoring-table-owner.sql")
echo "Migration 216 applied. Now run real_scoring_check.sh."
