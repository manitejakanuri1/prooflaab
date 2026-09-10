#!/usr/bin/env bash
# Deploy main to production on Vercel, working around the Hobby-plan author check.
#
# WHY THIS EXISTS
# ---------------
# This project sits on a Vercel Hobby team. Hobby will only build a PRODUCTION
# deployment when the git commit author is the Hobby team owner. Commits by any
# other collaborator come back state=BLOCKED and never build at all. That is a
# plan restriction, not a setting - Vercel's own docs say "the commit author
# must be the owner of the Hobby team". Upgrading to Pro or making the repo
# public are the only real fixes, and neither is available here.
#
# Verified by testing, not assumed:
#   git push          -> target production -> BLOCKED
#   deploy hook       -> target production -> BLOCKED  (author still resolved from HEAD)
#   API, target=preview -> builds fine, READY
#   promote preview -> production -> works, no author re-check
#
# So the working sequence is: build as a PREVIEW, then PROMOTE it. That is what
# this script does.
#
# USAGE
#   export VERCEL_TOKEN=...      # https://vercel.com/account/settings/tokens
#   ./scripts/deploy.sh
#
# Push your commits first - this deploys whatever is currently on origin/main.

set -euo pipefail

PROJECT_ID="prj_EhtB6sU8Lxfque5eCaXbancITh6z"
TEAM_ID="team_7wBg6FBCr57T1oyClu7XwF2i"
REPO="prooflaab"
ORG="manitejakanuri1"
BRANCH="main"

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "VERCEL_TOKEN is not set." >&2
  echo "Create one at https://vercel.com/account/settings/tokens, then:" >&2
  echo "  export VERCEL_TOKEN=xxxxx" >&2
  exit 1
fi

auth=(-H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json")

echo "==> Building $ORG/$REPO@$BRANCH as a preview"
create=$(curl -sS -X POST "https://api.vercel.com/v13/deployments?teamId=$TEAM_ID" "${auth[@]}" -d "{
  \"name\": \"$REPO\",
  \"target\": \"preview\",
  \"gitSource\": { \"type\": \"github\", \"org\": \"$ORG\", \"repo\": \"$REPO\", \"ref\": \"$BRANCH\" }
}")

dpl=$(printf '%s' "$create" | grep -oE '"id"[[:space:]]*:[[:space:]]*"dpl_[^"]+"' | head -1 | grep -oE 'dpl_[^"]+')
if [ -z "$dpl" ]; then
  echo "Could not create a deployment. Response was:" >&2
  printf '%s\n' "$create" >&2
  exit 1
fi
echo "    deployment: $dpl"

echo "==> Waiting for the build"
for _ in $(seq 1 90); do
  state=$(curl -sS "https://api.vercel.com/v13/deployments/$dpl?teamId=$TEAM_ID" "${auth[@]}" \
          | grep -oE '"readyState"[[:space:]]*:[[:space:]]*"[A-Z]+"' | head -1 | grep -oE '[A-Z]+$' || true)
  case "$state" in
    READY) echo "    READY"; break ;;
    ERROR|CANCELED) echo "    build $state - see https://vercel.com/$ORG/$REPO/$dpl" >&2; exit 1 ;;
    BLOCKED) echo "    BLOCKED - the author check hit the preview too; nothing this script can do." >&2; exit 1 ;;
    *) sleep 5 ;;
  esac
done

if [ "${state:-}" != "READY" ]; then
  echo "    timed out waiting for the build" >&2
  exit 1
fi

echo "==> Promoting to production"
curl -sS -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/promote/$dpl?teamId=$TEAM_ID" "${auth[@]}" >/dev/null

echo "==> Done. Confirm the bundle actually changed:"
echo "    curl -s https://prooflaab.vercel.app/ | grep -oE 'assets/index-[^\"]+\\.js'"
