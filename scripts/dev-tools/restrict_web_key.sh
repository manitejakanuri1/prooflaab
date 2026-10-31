#!/usr/bin/env bash
# MF-112: the "prooflab-web" Google API key (used by REAL and TEST servers for Google sign-in) had no limits.
# It is used server-side (functions, web-bff, auth-bridge), so a website-address limit would break sign-in.
# This limits it to the only two Google APIs those servers call with it. Owner-run:
#   bash scripts/dev-tools/restrict_web_key.sh
# Undo: gcloud services api-keys update ad12f17e-f53b-4307-b745-acbd109eb8b2 --clear-restrictions --project=prooflab-508214
set -euo pipefail
export CLOUDSDK_CORE_ACCOUNT=deploy.openfloor@gmail.com
# --no-check-existing-usage: on 31 Oct 2026 Google saw this key used for geocoding and Firebase installations.
# ProofLab code uses neither, and the key is in the public repo, so that traffic is someone else's; block it.
gcloud services api-keys update ad12f17e-f53b-4307-b745-acbd109eb8b2 --project=prooflab-508214 \
  --no-check-existing-usage --api-target=service=identitytoolkit.googleapis.com --api-target=service=securetoken.googleapis.com
echo "Key limited. Wait 5 minutes, then check sign-in: python scripts/healthcheck.py"
