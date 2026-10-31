#!/usr/bin/env bash
# REAL website, Stage 6.1 + gateway prerequisites (P3, P4): the secret and permission steps only.
# The owner runs this (the assistant is not allowed to write secrets or grant access). Safe to run twice:
# anything that already exists is kept. Prints no secret value.
#   bash scripts/dev-tools/real_identity_secrets.sh
set -euo pipefail
export CLOUDSDK_CORE_ACCOUNT=${CLOUDSDK_CORE_ACCOUNT:-deploy.openfloor@gmail.com}
P=prooflab-508214
SA() { echo "$1@$P.iam.gserviceaccount.com"; }
exists() { gcloud secrets describe "$1" --project=$P >/dev/null 2>&1; }
grant() { gcloud secrets add-iam-policy-binding "$1" --project=$P --member="serviceAccount:$(SA "$2")" \
            --role=roles/secretmanager.secretAccessor --quiet >/dev/null && echo "  $2 may read $1"; }

echo "1. Login bridge signing key (RSA private key; only the bridge reads it)"
exists prooflab-app-signing-key || openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null \
  | gcloud secrets create prooflab-app-signing-key --project=$P --replication-policy=automatic --data-file=- >/dev/null
grant prooflab-app-signing-key prooflab-rt-authbridge

echo "2. API key set: the bridge's new public key PLUS the old shared key (old tokens keep working)"
if ! exists prooflab-jwt-jwks; then
  PEM=$(gcloud secrets versions access latest --secret=prooflab-app-signing-key --project=$P)
  OLD=$(gcloud secrets versions access latest --secret=prooflab-jwt-secret --project=$P)
  PEM="$PEM" OLD="$OLD" python - <<'PY' | gcloud secrets create prooflab-jwt-jwks --project=$P --replication-policy=automatic --data-file=- >/dev/null
import base64, hashlib, json, os, sys
from cryptography.hazmat.primitives.serialization import load_pem_private_key
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
pub = load_pem_private_key(os.environ["PEM"].encode(), None).public_key().public_numbers()
n = b64(pub.n.to_bytes((pub.n.bit_length() + 7) // 8, "big"))
e = b64(pub.e.to_bytes((pub.e.bit_length() + 7) // 8, "big"))
kid = hashlib.sha256(n.encode()).digest()[:8].hex()          # same rule as auth-bridge/signer.ts
sys.stdout.write(json.dumps({"keys": [
  {"kty": "RSA", "n": n, "e": e, "alg": "RS256", "use": "sig", "kid": kid},
  {"kty": "oct", "k": b64(os.environ["OLD"].encode()), "alg": "HS256", "use": "sig"}]}))
PY
  unset PEM OLD
fi
grant prooflab-jwt-jwks prooflab-rt-api

echo "3. File grant secret (functions sign file links, files checks them)"
exists prooflab-file-grant-secret || python -c "import secrets,sys; sys.stdout.write(secrets.token_urlsafe(48))" \
  | gcloud secrets create prooflab-file-grant-secret --project=$P --replication-policy=automatic --data-file=- >/dev/null
grant prooflab-file-grant-secret prooflab-rt-functions
grant prooflab-file-grant-secret prooflab-rt-files

echo "4. Web gateway robot (no project roles) and its session key"
gcloud iam service-accounts describe "$(SA prooflab-rt-webbff)" --project=$P >/dev/null 2>&1 || \
  gcloud iam service-accounts create prooflab-rt-webbff --project=$P --display-name="ProofLab web gateway" >/dev/null
exists prooflab-web-bff-session-key || python -c "import secrets,sys; sys.stdout.write(secrets.token_urlsafe(32))" \
  | gcloud secrets create prooflab-web-bff-session-key --project=$P --replication-policy=automatic --data-file=- >/dev/null
grant prooflab-web-bff-session-key prooflab-rt-webbff
grant resend-api-key prooflab-rt-webbff

echo "Done. Tell Claude: secrets ready."
