#!/usr/bin/env bash
# The staging release gate (Wave 11): every automated proof, in one run, with one verdict.
# STAGING ONLY - nothing here touches production. Needs: gcloud signed in, the local staging
# site running (npx vite --mode staging --port 5173) for the browser journeys.
#
#   bash scripts/dev-tools/staging_release_gate.sh            # everything (about 15 minutes, a few paise of AI)
#   bash scripts/dev-tools/staging_release_gate.sh quick      # no browser, no real-audio run
#
# Prints PASS/FAIL per gate and exits non-zero if any gate fails.
set -uo pipefail
cd "$(dirname "$0")/../.."
MODE="${1:-full}"
OUT=e2e-out/release-gate; mkdir -p "$OUT"
FAILED=0
gate() {            # gate "name" command...
  local name="$1"; shift
  local log="$OUT/$(echo "$name" | tr ' /' '__').log"
  if "$@" > "$log" 2>&1; then
    printf 'PASS  %-46s %s\n' "$name" "$(grep -E '[0-9]+/[0-9]+ (checks|steps) passed|within limits|problems$|findings$|differences$|passed \|' "$log" | tail -1 | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-70)"
  else
    printf 'FAIL  %-46s see %s\n' "$name" "$log"; FAILED=$((FAILED + 1))
  fi
}

echo "== source checks"
gate "no secrets in tracked files"        python scripts/secret_scan.py
gate "migrations consistent"              python scripts/migrations.py check
gate "typecheck"                          npm run --silent typecheck
gate "unit tests"                         bash -c 'node --experimental-strip-types --test src/lib/*.test.ts'
gate "server function tests"              npx deno test --no-lock --allow-env --allow-import --allow-read supabase/functions/_shared/ supabase/functions/transcription-reap/
gate "server functions type-check"        bash -c 'npx deno check --no-lock functions-service/main.ts supabase/functions/*/index.ts'
gate "auth bridge tests"                  env PGRST_JWT_SECRET=ci-only-not-a-real-secret-0123456789 npx deno test --no-lock --allow-env --allow-net auth-bridge/
gate "files service tests"                env PGRST_JWT_SECRET=ci-only-not-a-real-secret npx deno test --no-lock --allow-env --allow-net --allow-read --allow-write files-service/
gate "token module tests (python)"        bash -c 'cd accounts && python test_apptoken.py && python test_sync_plan.py'
gate "transcription worker tests"         bash -c 'cd transcription-worker && python -m unittest test_server'

echo "== staging security"
gate "F1: only the bridge can sign"       python scripts/dev-tools/staging_f1_check.py
gate "cross-account sweep (all functions)" python scripts/dev-tools/staging_function_authz_check.py
gate "voice evidence binding/immutability" python scripts/dev-tools/staging_voice_binding_check.py
gate "student import all-or-nothing"      python scripts/dev-tools/staging_import_txn_check.py
gate "infrastructure matches infra/"      python scripts/infra_snapshot.py --check

echo "== staging scale (15,000 synthetic students)"
gate "screen queries + nightly jobs"      python scripts/dev-tools/staging_scale_check.py --jobs

if [ "$MODE" != "quick" ]; then
  echo "== staging end to end"
  gate "real audio through the voice pipeline" python scripts/dev-tools/staging_voice_e2e.py
  gate "browser journeys (all roles)"       node scripts/dev-tools/staging_browser_e2e.mjs
fi

echo
if [ "$FAILED" -eq 0 ]; then echo "RELEASE GATE: PASS (staging)"; else echo "RELEASE GATE: FAIL ($FAILED gate(s))"; fi
exit "$FAILED"
