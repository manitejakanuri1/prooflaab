#!/usr/bin/env bash
# REAL website: create the web gateway prooflab-web-bff (RC manifest section 4) from the exact image proven on TEST.
# The owner runs this (it opens a public web address, which the assistant may not do). BFF_RELEASE_READY is NOT set:
# /ready stays 503 until the checks pass. Safe to run twice (a second run makes a new revision with the same settings).
#   bash scripts/dev-tools/real_gateway_create.sh
set -euo pipefail
export CLOUDSDK_CORE_ACCOUNT=${CLOUDSDK_CORE_ACCOUNT:-deploy.openfloor@gmail.com}
P=prooflab-508214; R=asia-south1; U=https://prooflab; E=ysn2mpe6sa-el.a.run.app
IMG=asia-south1-docker.pkg.dev/prooflab-508214/cloud-run-source-deploy/prooflab-web-bff@sha256:ca16fe5a8bd009206208adebe567a19811431519a58224dc246ec6e6cab357c2
# The public browser sign-in key the REAL website already ships.
K=$(grep -E "^VITE_GOOGLE_API_KEY=" .env.production | cut -d= -f2- | tr -d '"\r')
[ -n "$K" ] || { echo "VITE_GOOGLE_API_KEY not found in .env.production"; exit 1; }
EF=$(gcloud run services describe prooflab-functions --region=$R --project=$P --format=json \
     | python -c "import json,sys; print([e['value'] for e in json.load(sys.stdin)['spec']['template']['spec']['containers'][0]['env'] if e['name']=='EMAIL_FROM'][0])")

gcloud run deploy prooflab-web-bff --project=$P --region=$R --image=$IMG \
  --service-account=prooflab-rt-webbff@$P.iam.gserviceaccount.com --allow-unauthenticated \
  --cpu=1 --memory=512Mi --timeout=60 --concurrency=80 --max-instances=2 --cpu-boost \
  --set-secrets=SESSION_KEY=prooflab-web-bff-session-key:1,RESEND_API_KEY=resend-api-key:latest \
  --set-env-vars="^|^ENVIRONMENT=production|GOOGLE_API_KEY=$K|AUTH_BRIDGE_URL=$U-auth-bridge-$E|POSTGREST_URL=$U-api-$E|FUNCTIONS_URL=$U-functions-$E|FILES_URL=$U-files-$E|ACCOUNTS_URL=$U-accounts-$E|TRANSCRIBER_URL=$U-transcriber-$E|BROWSER_ORIGINS=https://prooflab.co.in,https://www.prooflab.co.in,https://prooflab-508214.web.app|IDENTITY_PROJECT=$P|SITE_URL=https://prooflab.co.in|EMAIL_FROM=$EF" \
  --quiet
echo "Done. Tell Claude: gateway created."
