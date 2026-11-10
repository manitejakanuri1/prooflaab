# Shared by the REAL demo-college scripts. Owner-run only. Prints no password or secret.
# COPY FOR READING (11 Nov 2026). Run the original at scripts/dev-tools/real_demo/ - see scripts/demo/README.md.
set -euo pipefail
export CLOUDSDK_CORE_ACCOUNT=deploy.openfloor@gmail.com
P=prooflab-508214; B=gs://prooflab-508214_cloudbuild/sql
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DESK="$HOME/Desktop"
# Refuses on the TEST database (the TEST admin login only exists there).
GUARD="do \$g\$ begin if exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'this is the TEST database'; end if; end \$g\$;"

# Write: one file, one transaction, as the same database user the REAL migrations use. Any error undoes all of it.
real_write() {
  local tmp obj rc=0; tmp=$(mktemp); obj="$B/qa-demo-$(date +%s)-$RANDOM.sql"
  { echo "$GUARD"; echo "begin;"; cat "$@"; echo "commit;"; } > "$tmp"
  gcloud storage cp "$(cygpath -m "$tmp")" "$obj" --quiet
  gcloud sql import sql prooflab-db "$obj" --database=prooflab --user=postgres --project=$P --quiet || rc=$?
  gcloud storage rm "$obj" --quiet || true
  rm -f "$tmp"
  return $rc
}

# Read: inside a read-only transaction, through the REAL read job. Changes nothing.
real_read() {
  local tmp; tmp=$(mktemp)
  { echo '\pset tuples_only on'; echo '\pset format unaligned'; echo 'begin transaction read only;'
    echo "$GUARD"; cat "$@"; echo 'rollback;'; } > "$tmp"
  REAL_SQL_TAIL=2000 bash "$HERE/../real_sql.sh" "$tmp"
  rm -f "$tmp"
}
