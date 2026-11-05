#!/usr/bin/env bash
# Removes the ProofLab QA Demo college, its data, files and logins from REAL, and proves nothing else changed.
#   bash scripts/dev-tools/real_demo/real_cleanup.sh            trial: shows the exact list, removes nothing
#   bash scripts/dev-tools/real_demo/real_cleanup.sh --delete   really removes (only after a trial on the same day)
# The report is saved to the Desktop. It holds emails and counts, never passwords.
source "$(dirname "$0")/lib.sh"
REPORT="$DESK/prooflab_real_cleanup_report.txt"
LOGINS="$DESK/prooflab_real_demo_users.txt"     # kept until the logins are gone, so a re-run can finish the job

run_cleanup() {  # $1 = dry | delete
  local f rd; f=$(mktemp); rd=$(mktemp)
  { echo "select set_config('qa.mode', '$1', true);"; cat "$HERE/sql/cleanup.sql"; } > "$f"
  real_write "$f"
  echo "select line from qa_demo.report order by n;" > "$rd"
  # Logs can arrive late, so a short read is tried again before anyone is told it failed.
  for try in 1 2 3; do
    real_read "$rd" | grep -E '^(LOGIN|REMOVED|LEFT|SYSTEM_LOG|CHECK|PERMISSIONS|RESULT|MODE|FAILED): ' > "$REPORT" || true
    grep -qE '^(RESULT|FAILED): ' "$REPORT" && break
    sleep 30
  done
  rm -f "$f" "$rd"
  cat "$REPORT"
  grep -q '^RESULT: ' "$REPORT" && ! grep -q '^FAILED: ' "$REPORT"
}

if [ "${1:-}" != "--delete" ]; then
  run_cleanup dry || { echo "Trial failed. Nothing was removed. Paste this to Claude."; exit 1; }
  echo; echo "Trial only: nothing was removed. Report: $REPORT"
  exit 0
fi

# Refuse if the trial is missing or from another day: the owner must have seen the list.
[ -f "$REPORT" ] && [ "$(date -r "$REPORT" +%F)" = "$(date +%F)" ] && grep -q '^MODE: trial' "$REPORT" \
  || { echo "Run the trial first, read the list, then run --delete the same day."; exit 1; }
grep '^LOGIN: ' "$REPORT" >> "$LOGINS" || true   # adds to the list: a re-run must not forget logins not yet removed

echo "== 1/4 Database"
if ! run_cleanup delete; then
  echo "Database step did not report success. Logins and files untouched. Do not re-run. Paste this to Claude."
  exit 1
fi

echo "== 2/4 Files (voice recordings, resumes, photos of demo accounts only)"
while read -r _ id _; do
  for b in prooflab-private-508214 prooflab-public-508214; do
    gcloud storage ls "gs://$b/*/$id/**" 2>/dev/null | while read -r obj; do
      gcloud storage rm "$obj" --quiet && echo "removed $obj"
    done || true
  done
done < "$LOGINS"

echo "== 3/4 Logins (exact accounts in the list only)"
LOGINS="$LOGINS" P="$P" python - <<'PY'
import json, os, subprocess, urllib.error, urllib.request
p = os.environ["P"]
tok = subprocess.check_output("gcloud auth print-access-token", shell=True, text=True).strip()
def call(path, body):
    r = urllib.request.Request(f"https://identitytoolkit.googleapis.com/v1/projects/{p}{path}", json.dumps(body).encode(), method="POST",
                               headers={"Authorization": f"Bearer {tok}", "x-goog-user-project": p, "Content-Type": "application/json"})
    with urllib.request.urlopen(r) as x:
        return json.loads(x.read() or b"{}")
left = 0
# The list from the database, plus the fixed demo emails (a setup that stopped half way leaves logins the database never saw).
emails = {line.split()[2] for line in open(os.environ["LOGINS"], encoding="utf-8")}
emails |= {f"{k}@qa-demo.prooflab.invalid" for k in ["admin", "college", "company"] + [f"student{n:02d}" for n in range(1, 13)]}
for email in sorted(emails):
    found = call("/accounts:lookup", {"email": [email]}).get("users") or []
    for u in found:
        call("/accounts:delete", {"localId": u["localId"]})
    if call("/accounts:lookup", {"email": [email]}).get("users"):
        left += 1
    if found:
        print("removed login " + email)
raise SystemExit(1 if left else 0)
PY

echo "== 4/4 Remove the fingerprint schema, then final read"
f=$(mktemp); echo "drop schema qa_demo cascade;" > "$f"; real_write "$f"
cat > "$f" <<'SQL'
select 'FINAL: logins ' || (select count(*) from auth.users where email like '%@qa-demo.prooflab.invalid')
    || ', colleges ' || (select count(*) from public.colleges where name = 'ProofLab QA Demo')
    || ', fingerprint schemas ' || (select count(*) from pg_namespace where nspname = 'qa_demo');
SQL
real_read "$f" | grep -E '^FINAL: ' | tee -a "$REPORT"
rm -f "$f" "$LOGINS"
echo "Done. Proof saved: $REPORT"
echo "You can now delete $DESK/prooflab_real_logins.txt (those logins no longer work)."
