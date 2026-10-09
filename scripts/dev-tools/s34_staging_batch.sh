#!/usr/bin/env bash
# S34 staging batch: backup, migrations 104 + 105, functions, accounts, gateway, staging site, smoke, rollback.
# STAGING ONLY. Every service name below carries "staging"; nothing here can reach production.
#
#   bash scripts/dev-tools/s34_staging_batch.sh all      <commit>   # prepare, then switch, then smoke
#   bash scripts/dev-tools/s34_staging_batch.sh prepare  <commit>   # backup, migrations, new revisions at 0% traffic
#   bash scripts/dev-tools/s34_staging_batch.sh switch   <commit>   # traffic to the new revisions, publish staging site
#   bash scripts/dev-tools/s34_staging_batch.sh smoke    <commit>   # checks that need no login
#   bash scripts/dev-tools/s34_staging_batch.sh rollback <commit>   # traffic back; prints the site and database steps
#
# It refuses to run unless the worktree is exactly <commit> with nothing uncommitted, so the images and the
# site are that commit and nothing else. It stops at the first failure. The release switch
# (BFF_RELEASE_READY) is never read or changed here.
set -euo pipefail
cd "$(dirname "$0")/../.."
PHASE="${1:?phase: all|prepare|switch|smoke|rollback}"; SHA="${2:?full commit id}"
P=prooflab-508214; R=asia-south1; TAG=s34
STATE=e2e-out/s34-staging; mkdir -p "$STATE"
SERVICES="functions accounts web-bff"

[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "REFUSED: this worktree is not $SHA"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "REFUSED: uncommitted changes; the build would not be the commit"; exit 1; }

revision_at_100() { gcloud run services describe "prooflab-staging-$1" --project=$P --region=$R \
  --format='value(status.traffic.filter("percent=100").extract("revisionName").flatten())' | tr -d "[]'"; }
tagged_url() { gcloud run services describe "prooflab-staging-$1" --project=$P --region=$R \
  --format="value(status.traffic.filter(\"tag=$TAG\").extract(\"url\").flatten())" | tr -d "[]'"; }
site_version() { curl -sS -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "X-Goog-User-Project: $P" \
  "https://firebasehosting.googleapis.com/v1beta1/sites/prooflab-staging/channels/live" | python -c "import json,sys; print(json.load(sys.stdin)['release']['version']['name'].split('/')[-1])"; }
expect() { # expect "what" <wanted status> <actual status>
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1: wanted $2, got $3"; exit 1; fi; }

prepare() {
  echo "== 1. rollback targets (written before anything changes)"
  if [ ! -f "$STATE/rollback.env" ]; then
    { for s in $SERVICES; do echo "PREV_${s//-/_}=$(revision_at_100 "$s")"; done; echo "PREV_SITE=$(site_version)"; } > "$STATE/rollback.env"
  fi
  cat "$STATE/rollback.env"
  grep -qE '^PREV_functions=.+' "$STATE/rollback.env" && grep -qE '^PREV_SITE=.+' "$STATE/rollback.env" \
    || { echo "REFUSED: a rollback target is empty"; exit 1; }

  echo "== 2. database backup"
  gcloud sql backups create --instance=prooflab-staging-db --project=$P --description="before S34 ${SHA:0:7}"

  echo "== 3. migrations through the ledger (already-applied files are skipped; a changed file is refused)"
  bash scripts/dev-tools/staging_migrate.sh migration/104-ai-first-review-and-safe-resolution.sql
  bash scripts/dev-tools/staging_migrate.sh migration/105-live-controls.sql

  echo "== 4. new revisions at 0% traffic, tag $TAG (the old revisions keep serving)"
  for s in $SERVICES; do bash scripts/dev-tools/staging_deploy.sh "$s" --no-traffic --tag "$TAG"; done

  echo "== 5. the new revisions answer, before any traffic moves"
  ready=$(curl -sS "$(tagged_url functions)/ready")
  echo "$ready" | python -c "import json,sys; d=json.load(sys.stdin); ok=d.get('ok') and d.get('loaded')==d.get('expected'); print('functions /ready', d.get('loaded'), 'of', d.get('expected')); sys.exit(0 if ok else 1)"
  expect "accounts /ready on the new revision" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "$(tagged_url accounts)/ready")"
  expect "gateway /health on the new revision" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "$(tagged_url web-bff)/health")"
  expect "voice play refuses a caller with no login" 401 "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"voice_id":"00000000-0000-0000-0000-000000000000"}' "$(tagged_url functions)/company-voice-play")"
  expect "account removal refuses a caller with no login" 401 "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"student_ids":["00000000-0000-0000-0000-000000000000"],"confirm":"DELETE"}' "$(tagged_url accounts)/remove")"
  echo "PREPARED. Old revisions still serve 100%."
}

switch() {
  [ -f "$STATE/rollback.env" ] || { echo "REFUSED: run prepare first"; exit 1; }
  echo "== 6. traffic to the new revisions"
  for s in $SERVICES; do gcloud run services update-traffic "prooflab-staging-$s" --project=$P --region=$R --to-tags "$TAG=100" --quiet | tail -1; done
  echo "== 7. staging site from this commit"
  npx vite build --mode staging --outDir dist-staging
  HOSTING_SITE=prooflab-staging BFF_SERVICE=prooflab-staging-web-bff python scripts/deploy-hosting.py dist-staging
  echo "SWITCHED. Site version now: $(site_version)"
}

smoke() {
  echo "== 8. checks that need no login"
  python scripts/dev-tools/staging_rpc_authz_check.py
  python scripts/dev-tools/staging_function_authz_check.py
  S=https://prooflab-staging.web.app
  expect "site answers" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "$S/")"
  expect "signed-out database call is refused" 401 "$(curl -sS -o /dev/null -w '%{http_code}' "$S/api/db/profiles")"
  expect "signed-out account removal is refused" 401 "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H "Origin: $S" -H 'Content-Type: application/json' -d '{"student_ids":[],"confirm":"DELETE"}' "$S/api/accounts/remove")"
  expect "signed-out voice play is refused" 401 "$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H "Origin: $S" -H 'Content-Type: application/json' -d '{}' "$S/api/functions/company-voice-play")"
  echo "SMOKE PASSED. The signed-in checks in docs/teja-release/S34-LIVE-FUNCTIONALITY.md section 6 are still to do."
}

rollback() {
  [ -f "$STATE/rollback.env" ] || { echo "REFUSED: no recorded rollback targets"; exit 1; }
  # shellcheck disable=SC1090
  . "$STATE/rollback.env"
  gcloud run services update-traffic prooflab-staging-functions --project=$P --region=$R --to-revisions "$PREV_functions=100" --quiet | tail -1
  gcloud run services update-traffic prooflab-staging-accounts  --project=$P --region=$R --to-revisions "$PREV_accounts=100" --quiet | tail -1
  gcloud run services update-traffic prooflab-staging-web-bff   --project=$P --region=$R --to-revisions "$PREV_web_bff=100" --quiet | tail -1
  echo "Traffic is back on the previous revisions. Two steps are printed, not run:"
  python scripts/dev-tools/staging_rollback_plan.py --stable-revision "$PREV_web_bff" --site-version "$PREV_SITE"
  echo "Database (only if needed; settings an admin saved are kept):"
  echo "  bash scripts/dev-tools/staging_sql.sh migration/105-rollback-live-controls.sql"
}

case "$PHASE" in
  prepare) prepare ;; switch) switch ;; smoke) smoke ;; rollback) rollback ;;
  all) prepare; switch; smoke ;;
  *) echo "unknown phase $PHASE"; exit 2 ;;
esac
