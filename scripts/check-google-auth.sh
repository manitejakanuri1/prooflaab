#!/usr/bin/env bash
# Is the Google login chain wired correctly?
#
# Eight questions, none of which needs a password or changes anything.
#
# The login chain:
#
#   1. Does Identity Platform answer to our browser key, for our project?
#   2. Does the bridge refuse a token it cannot verify?
#   3. Is PostgREST up, and does it still refuse an anonymous caller?
#   4. Does the /rest/v1 prefix really need stripping?
#
# The file service:
#
#   5. Is a private file refused without a token?
#   6. Is a forged token refused?
#   7. Is a bucket nobody defined refused?
#   8. Does the public bucket answer without a token?
#
# Question 4 matters more than it looks. supabase-js addresses tables at
# <url>/rest/v1/<table>; our PostgREST serves from the root. If that 404 ever
# turns into a 200, the rewrite in src/integrations/google/client.ts has become
# wrong and should be removed.
set -uo pipefail

KEY="${VITE_GOOGLE_API_KEY:-AIzaSyCNv0YWVP5QTDRb4WPVccmosCMC8cH7nnw}"
BRIDGE="${VITE_AUTH_BRIDGE_URL:-https://prooflab-auth-bridge-ysn2mpe6sa-el.a.run.app}"
API="${VITE_POSTGREST_URL:-https://prooflab-api-ysn2mpe6sa-el.a.run.app}"

fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then printf '  ok    %-52s %s\n' "$1" "$3"
  else printf '  FAIL  %-52s got %s, wanted %s\n' "$1" "$3" "$2"; fail=1; fi
}

got=$(curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"nobody@prooflab.invalid","password":"x","returnSecureToken":true}' \
  | grep -oE 'INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|API_KEY_INVALID|[A-Z_]{6,}' | head -1)
case "$got" in
  INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND) check "identity platform answers to our key" "$got" "$got" ;;
  *) check "identity platform answers to our key" "INVALID_LOGIN_CREDENTIALS" "${got:-no answer}" ;;
esac

check "bridge refuses a forged token" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BRIDGE/token" \
      -H 'Authorization: Bearer not.a.token' -H 'Content-Type: application/json' -d '{}')"

check "postgrest refuses an anonymous read" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$API/student_profiles?select=full_name&limit=1")"

check "/rest/v1 prefix still needs stripping" 404 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$API/rest/v1/student_profiles?select=full_name&limit=1")"


# ---- phase 5: the file service --------------------------------------------
FILES="${VITE_FILES_URL:-https://prooflab-files-135298577404.asia-south1.run.app}"
ME=9f77c6d5-bd7c-489e-9410-3db888729328

check "file service refuses a private file with no token" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$FILES/file/resumes/$ME/anything.pdf")"

check "file service refuses a forged token" 401 \
  "$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer a.b.c' \
      "$FILES/file/resumes/$ME/anything.pdf")"

check "file service refuses an invented bucket" 400 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$FILES/file/payroll/$ME/x.csv")"

check "public bucket serves without a token" 404 \
  "$(curl -s -o /dev/null -w '%{http_code}' "$FILES/file/profile-photos/$ME/missing.jpg")"

echo
[ "$fail" -eq 0 ] && echo "all checks passed" || echo "something changed - do not flip VITE_BACKEND"
exit "$fail"
