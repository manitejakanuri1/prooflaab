#!/usr/bin/env bash
# Rebuild EVERY backend image from the current commit (clean tree required) and put them on
# staging, so the release manifest can name one commit for all of them. STAGING ONLY.
#   bash scripts/dev-tools/staging_rebuild_all.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
git diff --quiet HEAD -- . || { echo "working tree is not clean: commit first"; exit 1; }
P=prooflab-508214; R=asia-south1; REPO=$R-docker.pkg.dev/$P/cloud-run-source-deploy; SHA=$(git rev-parse --short HEAD)
for s in auth-bridge files accounts transcriber transcription-worker code-runner functions; do
  echo "== $s"; bash scripts/dev-tools/staging_deploy.sh "$s" | tail -2
done
for j in crawler bug-finder; do
  IMG=$REPO/prooflab-$j:stab-$SHA
  echo "== job $j"; gcloud builds submit --project=$P --tag=$IMG $j >/dev/null
  gcloud run jobs update prooflab-staging-$j --project=$P --region=$R --image=$IMG --quiet 2>&1 | tail -1
done
echo "all staging images now come from commit $SHA"
