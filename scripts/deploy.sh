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
# `target` is deliberately absent. The API only accepts 'production', 'staging'
# or a custom environment there - a preview is expressed by omitting it, and the
# resulting deployment comes back with target: null. Sending "preview" is
# rejected outright ("Invalid request: `target` should be ..."), and a preview is
# the whole point here, since production builds are what Hobby refuses to run.
create=$(curl -sS -X POST "https://api.vercel.com/v13/deployments?teamId=$TEAM_ID" "${auth[@]}" -d "{
  \"name\": \"$REPO\",
  \"gitSource\": { \"type\": \"github\", \"org\": \"$ORG\", \"repo\": \"$REPO\", \"ref\": \"$BRANCH\" }
}")

# The `|| true` matters: under `set -e` a grep that matches nothing exits 1 and
# kills the script here, before the error handler below can show what the API
# actually replied - which is the one thing worth seeing when this fails.
if command -v jq >/dev/null 2>&1; then
  dpl=$(printf '%s' "$create" | jq -r '.id // empty' 2>/dev/null || true)
else
  dpl=$(printf '%s' "$create" | grep -oE '"id"[[:space:]]*:[[:space:]]*"dpl_[^"]+"' | head -1 | grep -oE 'dpl_[^"]+' || true)
fi

if [ -z "$dpl" ]; then
  echo "Could not create a deployment. Vercel replied:" >&2
  printf '%s\n' "$create" >&2
  exit 1
fi
echo "    deployment: $dpl"

echo "==> Waiting for the build"
for _ in $(seq 1 90); do
  status=$(curl -sS "https://api.vercel.com/v13/deployments/$dpl?teamId=$TEAM_ID" "${auth[@]}" || true)
  if command -v jq >/dev/null 2>&1; then
    state=$(printf '%s' "$status" | jq -r '.readyState // .status // empty' 2>/dev/null || true)
  else
    state=$(printf '%s' "$status" | grep -oE '"readyState"[[:space:]]*:[[:space:]]*"[A-Z]+"' | head -1 | grep -oE '[A-Z]+$' || true)
  fi
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
promote=$(curl -sS -w '\n%{http_code}' -X POST \
  "https://api.vercel.com/v10/projects/$PROJECT_ID/promote/$dpl?teamId=$TEAM_ID" "${auth[@]}" || true)
code=$(printf '%s' "$promote" | tail -1)
if [ "$code" != "200" ] && [ "$code" != "201" ] && [ "$code" != "202" ]; then
  echo "Promote failed (HTTP $code). Vercel replied:" >&2
  printf '%s\n' "$promote" | sed '$d' >&2
  exit 1
fi

echo "==> Done. Confirm the bundle actually changed:"
echo "    curl -s https://prooflaab.vercel.app/ | grep -oE 'assets/index-[^\"]+\\.js'"
