#!/usr/bin/env bash
# Build and deploy ONE service to STAGING from the working tree. Never production.
#   scripts/dev-tools/staging_deploy.sh functions|files|auth-bridge|accounts|transcription-worker|transcriber [extra gcloud run deploy flags]
# The image tag is stab-<short sha>[-dirty]; the same image is what production would get.
set -euo pipefail
P=prooflab-508214; R=asia-south1; REPO=$R-docker.pkg.dev/$P/cloud-run-source-deploy
TAG=stab-$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- . || echo -$(date +%H%M))
case "$1" in
  functions) IMG=$REPO/prooflab-functions:$TAG
             gcloud builds submit --project=$P --config=functions-service/cloudbuild.yaml --substitutions=_IMAGE=$IMG . >/dev/null ;;
  files)     IMG=$REPO/prooflab-files:$TAG
             gcloud builds submit --project=$P --tag=$IMG files-service >/dev/null ;;
  accounts|transcription-worker|transcriber|code-runner)
             IMG=$REPO/prooflab-$1:$TAG
             gcloud builds submit --project=$P --tag=$IMG $1 >/dev/null ;;
  auth-bridge) IMG=$REPO/prooflab-auth-bridge:$TAG
             gcloud builds submit --project=$P --tag=$IMG auth-bridge >/dev/null ;;
  *) echo "unknown service $1"; exit 2 ;;
esac
gcloud run deploy prooflab-staging-$1 --project=$P --region=$R --image=$IMG --quiet "${@:2}" 2>&1 | tail -2
URL=$(gcloud run services describe prooflab-staging-$1 --project=$P --region=$R --format='value(status.url)')
echo "deployed $IMG"; curl -s "$URL/ready" | head -c 300; echo; gcloud run services describe prooflab-staging-$1 --project=$P --region=$R --format="value(status.latestReadyRevisionName)"
