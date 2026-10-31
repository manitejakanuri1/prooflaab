#!/usr/bin/env bash
# MF-112 follow-up (owner 31 Oct 2026): replace the Google sign-in key that sat in the public repo.
#   1. new key "prooflab-identity", limited to the two sign-in APIs
#   2. stored only in Secret Manager (prooflab-identity-api-key), never printed
#   3. REAL functions + REAL login gateway read it from there (gateway kept pinned, moved to the new revision)
#   4. checks: services ready, new key answers Google sign-in
#   5. only then the old key (ad12f17e..., the one in old GitHub history) is deleted
# Any failure stops the script before the old key is deleted. Owner-run:
#   bash scripts/dev-tools/rotate_web_key.sh
set -euo pipefail
export CLOUDSDK_CORE_ACCOUNT=deploy.openfloor@gmail.com
P=prooflab-508214; R=asia-south1; SEC=prooflab-identity-api-key; OLD=ad12f17e-f53b-4307-b745-acbd109eb8b2

echo "== 1/5 new key"
UID_NEW=$(gcloud services api-keys create --project=$P --display-name=prooflab-identity \
  --api-target=service=identitytoolkit.googleapis.com --api-target=service=securetoken.googleapis.com \
  --format='value(response.uid)' 2>/dev/null)
[ -n "$UID_NEW" ] || { echo "key not created - stop"; exit 1; }
echo "   created key $UID_NEW"

echo "== 2/5 secret"
gcloud secrets describe $SEC --project=$P >/dev/null 2>&1 || gcloud secrets create $SEC --project=$P --replication-policy=automatic --quiet >/dev/null
gcloud services api-keys get-key-string $UID_NEW --project=$P --format='value(keyString)' | tr -d '\r\n' \
  | gcloud secrets versions add $SEC --project=$P --data-file=- --quiet >/dev/null
echo "   stored in Secret Manager ($SEC)"

echo "== 3/5 REAL services read the secret"
for S in prooflab-functions prooflab-web-bff; do
  SA=$(gcloud run services describe $S --region=$R --project=$P --format='value(spec.template.spec.serviceAccountName)')
  gcloud secrets add-iam-policy-binding $SEC --project=$P --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor --quiet >/dev/null
  LATEST=$(gcloud run services describe $S --region=$R --project=$P --format='value(spec.traffic[0].latestRevision)')
  PINNED=$(gcloud run services describe $S --region=$R --project=$P --format='value(spec.traffic[0].revisionName)')
  if [ "$LATEST" != "True" ] && [ -n "$PINNED" ]; then
    gcloud run services update $S --region=$R --project=$P --remove-env-vars=GOOGLE_API_KEY \
      --update-secrets=GOOGLE_API_KEY=$SEC:latest --no-traffic --quiet
    NEW=$(gcloud run services describe $S --region=$R --project=$P --format='value(status.latestCreatedRevisionName)')
    gcloud run services update-traffic $S --region=$R --project=$P --to-revisions=$NEW=100 --quiet
    echo "   $S: pinned revision moved $PINNED -> $NEW"
  else
    gcloud run services update $S --region=$R --project=$P --remove-env-vars=GOOGLE_API_KEY \
      --update-secrets=GOOGLE_API_KEY=$SEC:latest --quiet
    echo "   $S: updated"
  fi
done

echo "== 4/5 checks"
sleep 20
for S in prooflab-functions prooflab-web-bff; do
  U=$(gcloud run services describe $S --region=$R --project=$P --format='value(status.url)')
  OUT=$(curl -s "$U/ready")
  echo "   $S /ready: $(echo "$OUT" | head -c 160)"
  echo "$OUT" | grep -q '"ok":true\|"ready":true' || { echo "$S not ready - stop, old key kept, tell Claude"; exit 1; }
done
K=$(gcloud secrets versions access latest --secret=$SEC --project=$P)
ANS=$(curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=$K" -H "Content-Type: application/json" -d '{"idToken":"x"}')
unset K
echo "$ANS" | grep -q INVALID_ID_TOKEN || { echo "new key not accepted by Google sign-in - stop, old key kept, tell Claude"; exit 1; }
echo "   new key answers Google sign-in"

echo "== 5/5 delete old key"
gcloud services api-keys delete $OLD --project=$P --quiet
echo "Done. Tell Claude: key rotated."
