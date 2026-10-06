#!/usr/bin/env bash
# The staging release gate (Wave 11): every automated proof, in one run, with one verdict.
# STAGING ONLY - nothing here touches production. Needs: gcloud signed in, the local staging
# site running (npx vite --mode staging --port 5173) for the browser journeys.
#
#   bash scripts/dev-tools/staging_release_gate.sh            # everything (about 15 minutes, a few paise of AI)
#   bash scripts/dev-tools/staging_release_gate.sh quick      # no browser, no real-audio run
#   bash scripts/dev-tools/staging_release_gate.sh noload     # everything except the two load steps
#   bash scripts/dev-tools/staging_release_gate.sh nopaid     # everything except the load steps and the two paid-AI steps (crawler Lot writing, voice scoring)
#   E2E_BASE=https://prooflab-staging.web.app selects the deployed staging site for the browser journeys.
#
# Prints PASS/FAIL per gate and exits non-zero if any gate fails.
set -uo pipefail
cd "$(dirname "$0")/../.."
MODE="${1:-full}"
OUT=e2e-out/release-gate; mkdir -p "$OUT"
FAILED=0
ADVISORY_FAILED=0
# advisory "name" command... : runs and reports like gate(), but a failure does NOT block the release.
# Used only for future-scale stress tests beyond the 2,000-student launch target.
advisory() {
  local name="$1"; shift
  local log="$OUT/$(echo "$name" | tr ' /' '__').log"
  "$@" > "$log" 2>&1; local rc=$?
  echo "exit=$rc" >> "$log"
  if [ "$rc" -eq 0 ]; then
    printf 'ADVISORY PASS  exit=0  %-37s %s\n' "$name" "$(grep -E '[0-9]+/[0-9]+ (checks|steps) passed|within limits' "$log" | tail -1 | cut -c1-60)"
  else
    printf 'ADVISORY FAIL  exit=%s  %-37s does not block the 2,000-student launch; see %s\n' "$rc" "$name" "$log"; ADVISORY_FAILED=$((ADVISORY_FAILED + 1))
  fi
}
gate() {            # gate "name" command...
  local name="$1"; shift
  local log="$OUT/$(echo "$name" | tr ' /' '__').log"
  "$@" > "$log" 2>&1; local rc=$?
  echo "exit=$rc" >> "$log"
  if [ "$rc" -eq 0 ]; then
    printf 'PASS  exit=0  %-46s %s\n' "$name" "$(grep -E '[0-9]+/[0-9]+ (checks|steps) passed|within limits|problems$|findings$|differences$|active occurrences$|passed \|' "$log" | tail -1 | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-70)"
  else
    printf 'FAIL  exit=%s  %-46s see %s\n' "$rc" "$name" "$log"; FAILED=$((FAILED + 1))
  fi
}

echo "== source checks"
gate "no secrets in tracked files"        python scripts/secret_scan.py
gate "legacy guard (retired architecture)" python scripts/legacy_guard.py
gate "migrations consistent"              python scripts/migrations.py check
gate "typecheck"                          npm run --silent typecheck
gate "unit tests"                         bash -c 'node --experimental-strip-types --test src/lib/*.test.ts'
gate "server function tests"              npx deno test --no-lock --allow-env --allow-import --allow-read supabase/functions/_shared/ supabase/functions/transcription-reap/
gate "server functions type-check"        bash -c 'npx deno check --no-lock functions-service/main.ts supabase/functions/*/index.ts'
gate "auth bridge tests"                  env PGRST_JWT_SECRET=ci-only-not-a-real-secret-0123456789 npx deno test --no-lock --allow-env --allow-net auth-bridge/
gate "files service tests"                env PGRST_JWT_SECRET=ci-only-not-a-real-secret npx deno test --no-lock --allow-env --allow-net --allow-read --allow-write files-service/
gate "token module tests (python)"        bash -c 'cd accounts && python test_apptoken.py && python test_sync_plan.py'
gate "transcription worker tests"         bash -c 'cd transcription-worker && python -m unittest test_server'
gate "English-only gate rule"             bash -c 'cd transcriber && python test_language_gate.py'

gate "CI green: runner suite + artifact hand-off" python scripts/dev-tools/ci_green_check.py

echo "== staging security"
gate "F1: only the bridge can sign"       python scripts/dev-tools/staging_f1_check.py
gate "cross-account sweep (all functions)" python scripts/dev-tools/staging_function_authz_check.py
gate "voice evidence binding/immutability" python scripts/dev-tools/staging_voice_binding_check.py
gate "student import all-or-nothing"      python scripts/dev-tools/staging_import_txn_check.py
gate "service identity (Scheduler, runner)" python scripts/dev-tools/staging_identity_check.py
gate "suspended account, old ticket refused" python scripts/dev-tools/staging_suspended_check.py
gate "evaluator type integrity"           python scripts/dev-tools/staging_evaluator_type_check.py
gate "database permissions (D1-D4, D2 defaults)" python scripts/dev-tools/staging_rpc_authz_check.py
gate "database behaviour (D3, D4, cross-tenant)" python scripts/dev-tools/staging_d4_behaviour_check.py
gate "infrastructure matches infra/"      python scripts/infra_snapshot.py --check

echo "== staging scale (screens and nightly jobs on the 15,000-student dataset; launch target is 2,000)"
gate "screen queries + nightly jobs"      python scripts/dev-tools/staging_scale_check.py --jobs
if [ "$MODE" != "quick" ]; then
  gate "daily Lots at release target (2,000)" python scripts/dev-tools/staging_daily_lots_release2k_check.py
  advisory "daily Lots stress (15,000): statuses" python scripts/dev-tools/staging_daily_lots_status_check.py
fi

if [ "$MODE" != "quick" ]; then
  echo "== staging end to end"
  # nopaid: skips only the two steps that call the paid AI (Lot writing, voice scoring); every other gate runs.
  if [ "$MODE" != "nopaid" ]; then
  gate "crawler: source to student-ready Lot"  python scripts/dev-tools/staging_crawler_e2e.py
  fi
  gate "bug-finder job (plumbing run)"        python scripts/dev-tools/staging_bugfinder_check.py
  if [ "$MODE" != "nopaid" ]; then
  gate "real audio through the voice pipeline" python scripts/dev-tools/staging_voice_e2e.py
  fi
  if [ "$MODE" != "noload" ] && [ "$MODE" != "nopaid" ]; then
  gate "code runner under load (10, 20 students)" bash -c 'out=$(python scripts/dev-tools/staging_load_test.py runcode 10 20); echo "$out"; [ "$(echo "$out" | grep -c "errors=0 ")" = "2" ] && echo "2/2 checks passed"'
  gate "voice burst (10 recordings at once)"  bash -c 'out=$(python scripts/dev-tools/staging_load_test.py voice e2e-out/loadvoice.wav 10); echo "$out"; echo "$out" | grep -q "scored=10 failed=0" && echo "1/1 checks passed"'
  fi
  gate "browser journeys (all roles)"       node scripts/dev-tools/staging_browser_e2e.mjs
fi

echo
[ "$ADVISORY_FAILED" -gt 0 ] && echo "ADVISORY: $ADVISORY_FAILED future-scale stress check(s) failed (15,000 students) - not part of the launch verdict"
if [ "$FAILED" -eq 0 ]; then echo "FINAL STAGING RELEASE GATE [${MODE^^}]: PASS  (commit $(git rev-parse --short HEAD), $(date -u +%Y-%m-%dT%H:%MZ))"; else echo "FINAL STAGING RELEASE GATE [${MODE^^}]: FAIL ($FAILED gate(s))"; fi
exit "$FAILED"
