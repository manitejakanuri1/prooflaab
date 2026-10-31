#!/usr/bin/env bash
# REAL website, gateway checks E4 + E5, then tell GitHub where the gateway is. Owner-run.
# Does NOT set PRODUCTION_RELEASE_APPROVED_SHA: the website stays as it is until the release.
#   bash scripts/dev-tools/real_gateway_ready.sh
set -uo pipefail
export CLOUDSDK_CORE_ACCOUNT=${CLOUDSDK_CORE_ACCOUNT:-deploy.openfloor@gmail.com}
G=https://prooflab-web-bff-ysn2mpe6sa-el.a.run.app

echo "E4. Mark the gateway ready"
gcloud run services update prooflab-web-bff --project=prooflab-508214 --region=asia-south1 \
  --update-env-vars=BFF_RELEASE_READY=true --quiet 2>&1 | grep -E "revision \[|ERROR"
echo "  /ready: $(curl -s -w ' [%{http_code}]' $G/ready)"

echo "E5. REAL gateway check (read-only)"
python -X utf8 scripts/dev-tools/production_bff_preflight.py

echo "GitHub: where the gateway is (releases nothing)"
gh variable set PRODUCTION_BFF_SERVICE --repo manitejakanuri1/prooflaab --body prooflab-web-bff
gh variable set PRODUCTION_BFF_HEALTH_URL --repo manitejakanuri1/prooflaab --body $G
gh variable list --repo manitejakanuri1/prooflaab | grep -E "PRODUCTION_" || true
echo "Done. Paste this output to Claude."
