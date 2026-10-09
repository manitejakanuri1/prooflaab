#!/usr/bin/env bash
# S34 staging release pipeline. STAGING ONLY: every service, database, job and site named below carries "staging".
# Nothing here can reach production, and the release switch (BFF_RELEASE_READY) is never read or changed.
#
#   bash scripts/dev-tools/s34_staging_batch.sh preflight <commit>   # READ-ONLY: is everything in place?
#   bash scripts/dev-tools/s34_staging_batch.sh prepare   <commit>   # backup, migrations, builds, canaries at 0% traffic
#   bash scripts/dev-tools/s34_staging_batch.sh switch    <commit>   # traffic to the canaries, publish the staging site
#   bash scripts/dev-tools/s34_staging_batch.sh smoke     <commit>   # checks that need no login
#   bash scripts/dev-tools/s34_staging_batch.sh e2e       <commit>   # Sidhu's signed-in browser suite + S34 recipes
#   bash scripts/dev-tools/s34_staging_batch.sh rollback  <commit>   # traffic back; prints the site and database steps
#   bash scripts/dev-tools/s34_staging_batch.sh all       <commit>   # preflight, prepare, switch, smoke, e2e
#
# Two locks:
#   1. The worktree must be exactly <commit> with nothing uncommitted, so images and site are that commit only.
#   2. Every phase except preflight needs STAGING_RELEASE_AUTHORIZED=<commit> in the environment. The owner sets
#      it for the commit they approved; a different commit, or no approval, is refused.
# It stops at the first failure. Evidence is written to e2e-out/s34-staging/ (not in git).
set -euo pipefail
cd "$(dirname "$0")/../.."
PHASE="${1:?phase: preflight|prepare|switch|smoke|e2e|rollback|all}"; SHA="${2:?full commit id}"
P=prooflab-508214; R=asia-south1; TAG=s34; SITE=https://prooflab-staging.web.app
STATE=e2e-out/s34-staging; mkdir -p "$STATE"; EVIDENCE="$STATE/evidence-${SHA:0:7}.txt"
SERVICES="functions accounts web-bff"

[ "$(git rev-parse HEAD)" = "$SHA" ] || { echo "REFUSED: this worktree is not $SHA"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "REFUSED: uncommitted changes; the build would not be the commit"; exit 1; }
authorized() { [ "${STAGING_RELEASE_AUTHORIZED:-}" = "$SHA" ] || { echo "REFUSED: $1 needs STAGING_RELEASE_AUTHORIZED=$SHA (the owner's approval of this exact commit)"; exit 1; }; }

describe() { gcloud run services describe "prooflab-staging-$1" --project=$P --region=$R --format="$2"; }
revision_at_100() { describe "$1" 'value(status.traffic.filter("percent=100").extract("revisionName").flatten())'; }
tagged() { describe "$1" "value(status.traffic.filter(\"tag=$TAG\").extract(\"$2\").flatten())"; }
site_version() { curl -sS -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "X-Goog-User-Project: $P" \
  "https://firebasehosting.googleapis.com/v1beta1/sites/prooflab-staging/channels/live" | python -c "import json,sys; print(json.load(sys.stdin)['release']['version']['name'].split('/')[-1])"; }
live_entry() { curl -sS "$SITE/" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1; }
built_entry() { grep -oE 'index-[A-Za-z0-9_-]+\.js' dist-staging/index.html | head -1; }
status_of() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }
expect() { if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1: wanted $2, got $3"; exit 1; fi; }
ledger() { # read-only: which of the migrations this release needs are recorded on staging
  local q; q=$(mktemp --suffix=.sql)
  printf '%s\n' '\pset tuples_only on' 'begin transaction read only;' \
    "select 'LEDGER ' || coalesce(string_agg(version::text, ',' order by version::text), 'none') from public.schema_migrations where version::text ~ '^(9[2-8]|10[0-5])[a-z]?-';" 'rollback;' > "$q"
  bash scripts/dev-tools/staging_sql.sh "$q" | grep -o 'LEDGER .*' | head -1
}

preflight() {
  echo "== preflight (read-only) for $SHA"
  echo "CI on this commit:"; gh run list --repo manitejakanuri1/prooflaab --commit "$SHA" --json name,conclusion --jq '.[] | "  \(.name): \(.conclusion)"'
  echo "serving now:"; for s in $SERVICES; do echo "  $s: $(revision_at_100 "$s")"; done; echo "  site: $(site_version) ($(live_entry))"
  L=$(ledger); echo "$L"
  case ",${L#LEDGER }," in *,103-*) echo "PASS  migration 103 is recorded (104 needs it)";; *) echo "FAIL  migration 103 is not recorded on staging: reconcile the ledger first"; exit 1;; esac
  env_names=$(describe functions 'value(spec.template.spec.containers[0].env[].name)')
  for n in RESEND_API_KEY EMAIL_FROM PRIVATE_MOUNT PUBLIC_MOUNT; do case ";$env_names;" in *";$n;"*) echo "PASS  functions has $n";; *) echo "FAIL  functions has no $n"; exit 1;; esac; done
  case ";$(describe web-bff 'value(spec.template.spec.containers[0].env[].name)');" in
    *";BFF_RELEASE_READY;"*) echo "NOTE  the release switch is set on the staging gateway";;
    *) echo "NOTE  the release switch is NOT set: signed-in pages stay closed and the e2e phase cannot pass until the owner sets it";; esac
  for v in E2E_ADMIN_EMAIL E2E_TPO_EMAIL E2E_COMPANY_EMAIL E2E_STUDENT_EMAIL E2E_ESTABLISHED_EMAIL; do
    [ -n "${!v:-}" ] && echo "PASS  $v is set" || echo "NOTE  $v is not set: the e2e phase will refuse"; done
  echo "PREFLIGHT DONE. Nothing was changed."
}

prepare() {
  authorized prepare
  echo "== 1. rollback targets (written before anything changes)"
  [ -f "$STATE/rollback.env" ] || { for s in $SERVICES; do echo "PREV_${s//-/_}=$(revision_at_100 "$s")"; done; echo "PREV_SITE=$(site_version)"; } > "$STATE/rollback.env"
  cat "$STATE/rollback.env"
  if grep -qE '=$' "$STATE/rollback.env"; then echo "REFUSED: a rollback target is empty"; exit 1; fi

  echo "== 2. database backup"
  gcloud sql backups create --instance=prooflab-staging-db --project=$P --description="before S34 ${SHA:0:7}"

  echo "== 3. migrations through the ledger (already-applied files are skipped; a changed file is refused)"
  bash scripts/dev-tools/staging_migrate.sh migration/104-ai-first-review-and-safe-resolution.sql
  bash scripts/dev-tools/staging_migrate.sh migration/105-live-controls.sql

  echo "== 4. build from the commit; canaries at 0% traffic, tag $TAG, labelled with the commit"
  for s in $SERVICES; do bash scripts/dev-tools/staging_deploy.sh "$s" --no-traffic --tag "$TAG" --labels "commit-sha=$SHA"; done

  echo "== 5. exact-commit evidence"
  { echo "commit $SHA"; date -u +"prepared %Y-%m-%dT%H:%M:%SZ"; ledger
    for s in $SERVICES; do rev=$(tagged "$s" revisionName)
      echo "$s revision=$rev image=$(gcloud run revisions describe "$rev" --project=$P --region=$R --format='value(status.imageDigest)') label=$(gcloud run revisions describe "$rev" --project=$P --region=$R --format='value(metadata.labels.commit-sha)')"
    done; } | tee "$EVIDENCE"
  for s in $SERVICES; do grep -q "^$s .*label=$SHA$" "$EVIDENCE" || { echo "FAIL  the $s canary is not labelled with this commit"; exit 1; }; done

  echo "== 6. the canaries answer, before any traffic moves"
  curl -sS "$(tagged functions url)/ready" | python -c "import json,sys; d=json.load(sys.stdin); print('functions /ready', d.get('loaded'), 'of', d.get('expected')); sys.exit(0 if d.get('ok') and d.get('loaded')==d.get('expected')==35 else 1)"
  expect "accounts /ready" 200 "$(status_of "$(tagged accounts url)/ready")"
  expect "gateway /health" 200 "$(status_of "$(tagged web-bff url)/health")"
  expect "voice play refuses a caller with no login" 401 "$(status_of -X POST -H 'Content-Type: application/json' -d '{"voice_id":"00000000-0000-0000-0000-000000000000"}' "$(tagged functions url)/company-voice-play")"
  expect "account removal refuses a caller with no login" 401 "$(status_of -X POST -H 'Content-Type: application/json' -d '{"student_ids":["00000000-0000-0000-0000-000000000000"],"confirm":"DELETE"}' "$(tagged accounts url)/remove")"
  for s in $SERVICES; do . "$STATE/rollback.env"; v="PREV_${s//-/_}"; expect "$s still serves the previous revision" "${!v}" "$(revision_at_100 "$s")"; done
  echo "PREPARED. The previous revisions still serve 100%."
}

switch() {
  authorized switch
  [ -f "$EVIDENCE" ] || { echo "REFUSED: run prepare for this commit first"; exit 1; }
  echo "== 7. traffic to the canaries"
  for s in $SERVICES; do gcloud run services update-traffic "prooflab-staging-$s" --project=$P --region=$R --to-tags "$TAG=100" --quiet | tail -1; done
  echo "== 8. staging site from this commit"
  npx vite build --mode staging --outDir dist-staging
  HOSTING_SITE=prooflab-staging BFF_SERVICE=prooflab-staging-web-bff python scripts/deploy-hosting.py dist-staging
  expect "the live staging site is this build" "$(built_entry)" "$(live_entry)"
  echo "site version=$(site_version) entry=$(live_entry)" | tee -a "$EVIDENCE"
}

smoke() {
  authorized smoke
  echo "== 9. checks that need no login"
  python scripts/dev-tools/staging_rpc_authz_check.py
  python scripts/dev-tools/staging_function_authz_check.py
  expect "site answers" 200 "$(status_of "$SITE/")"
  expect "signed-out database call is refused" 401 "$(status_of "$SITE/api/db/profiles")"
  expect "signed-out account removal is refused" 401 "$(status_of -X POST -H "Origin: $SITE" -H 'Content-Type: application/json' -d '{"student_ids":[],"confirm":"DELETE"}' "$SITE/api/accounts/remove")"
  expect "signed-out voice play is refused" 401 "$(status_of -X POST -H "Origin: $SITE" -H 'Content-Type: application/json' -d '{}' "$SITE/api/functions/company-voice-play")"
  echo "SMOKE PASSED (signed-out checks only)."
}

e2e() {
  authorized e2e
  for v in E2E_ADMIN_EMAIL E2E_TPO_EMAIL E2E_COMPANY_EMAIL E2E_STUDENT_EMAIL E2E_ESTABLISHED_EMAIL; do
    [ -n "${!v:-}" ] || { echo "REFUSED: $v is not set. The signed-in suite runs only with the owner-approved staging accounts."; exit 1; }; done
  [ -f dist-staging/index.html ] || npx vite build --mode staging --outDir dist-staging
  echo "== 10. signed-in browser suite on the deployed site (must be build $(built_entry))"
  node scripts/dev-tools/sidhu_s32_live_e2e.mjs --confirm-staging --expect-entry "$(built_entry)" --allow-writes --db-verify --out "$STATE/e2e-${SHA:0:7}"
  echo "E2E FINISHED with exit 0. Send $STATE/e2e-${SHA:0:7}/matrix.csv and the screenshots to Sidhu for the independent sign-off."
}

rollback() {
  authorized rollback
  [ -f "$STATE/rollback.env" ] || { echo "REFUSED: no recorded rollback targets"; exit 1; }
  . "$STATE/rollback.env"
  gcloud run services update-traffic prooflab-staging-functions --project=$P --region=$R --to-revisions "$PREV_functions=100" --quiet | tail -1
  gcloud run services update-traffic prooflab-staging-accounts  --project=$P --region=$R --to-revisions "$PREV_accounts=100" --quiet | tail -1
  gcloud run services update-traffic prooflab-staging-web-bff   --project=$P --region=$R --to-revisions "$PREV_web_bff=100" --quiet | tail -1
  echo "Traffic is back on the previous revisions. Two steps are printed, not run:"
  python scripts/dev-tools/staging_rollback_plan.py --stable-revision "$PREV_web_bff" --site-version "$PREV_SITE"
  echo "Database, only if needed (put the images back first; saved settings are kept, every student's audio sharing goes off):"
  echo "  bash scripts/dev-tools/staging_sql.sh migration/105-rollback-live-controls.sql"
}

case "$PHASE" in
  preflight) preflight ;; prepare) prepare ;; switch) switch ;; smoke) smoke ;; e2e) e2e ;; rollback) rollback ;;
  all) preflight; prepare; switch; smoke; e2e ;;
  *) echo "unknown phase $PHASE"; exit 2 ;;
esac
