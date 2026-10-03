#!/usr/bin/env bash
# Rebuild EVERY backend image from the current commit (clean tree required) and put them on
# staging, so the release manifest can name one commit for all of them. STAGING ONLY.
#   bash scripts/dev-tools/staging_rebuild_all.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
git diff --quiet HEAD -- functions-service supabase/functions auth-bridge files-service accounts transcriber transcription-worker code-runner crawler bug-finder \n  || { echo "service source differs from the commit: commit first"; exit 1; }
P=prooflab-508214; R=asia-south1; REPO=$R-docker.pkg.dev/$P/cloud-run-source-deploy; SHA=$(git rev-parse --short HEAD)
for s in ${SERVICES:-auth-bridge files accounts transcriber transcription-worker code-runner functions}; do
  echo "== $s"; bash scripts/dev-tools/staging_deploy.sh "$s" | tail -2
done
for j in ${JOBS-crawler bug-finder}; do
  IMG=$REPO/prooflab-$j:stab-$SHA
  echo "== job $j"; gcloud builds submit --project=$P --tag=$IMG $j >/dev/null
  gcloud run jobs update prooflab-staging-$j --project=$P --region=$R --image=$IMG --quiet >/dev/null 2>&1 && echo "job $j -> $IMG"
done
echo "all staging images now come from commit $SHA"
