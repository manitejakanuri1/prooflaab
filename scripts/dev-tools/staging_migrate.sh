#!/usr/bin/env bash
# Apply ONE migration to STAGING through the ledger (public.schema_migrations):
# skipped if already recorded, refused if the file changed after it was applied,
# recorded with its checksum when it runs. Never production.
#   scripts/dev-tools/staging_migrate.sh migration/68-something.sql
set -euo pipefail
T=$(mktemp --suffix=.sql)
python scripts/migrations.py wrap "$1" > "$T"
bash scripts/dev-tools/staging_sql.sh "$T"
