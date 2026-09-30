# Owner-run commands (blocked for the assistant by the auto-mode safety check)

Run in Git Bash from the repository root, signed in to gcloud as the project owner.
Nothing here prints a secret: the database URI is passed to the job as a secret
reference and only used inside the container. Paste the outputs back.

## 1. Production read-only database audit (G01)

```bash
P=prooflab-508214; R=asia-south1
# temporary job: postgres client, prod Cloud SQL socket, DB URI by secret reference only
gcloud run jobs create prooflab-prod-readonly-audit --project=$P --region=$R \
  --image=postgres:17 --service-account=135298577404-compute@developer.gserviceaccount.com \
  --set-cloudsql-instances=$P:$R:prooflab-db --set-secrets=DB_URI=prooflab-db-uri:latest \
  --command=bash --args="-c,echo ready" --max-retries=0 --task-timeout=600 --quiet

# run the read-only SQL (BEGIN READ ONLY ... ROLLBACK, plus default_transaction_read_only=on)
SQLB64=$(base64 -w0 docs/closure/PROD-READONLY-AUDIT-2026-09-30.sql)
SCRIPT="echo $SQLB64 | base64 -d > /tmp/q.sql; PGOPTIONS='-c default_transaction_read_only=on' psql \"\$DB_URI\" -X -q -A -t -F ' | ' -f /tmp/q.sql 2>&1; echo __EXIT=\$?"
B=$(printf '%s' "$SCRIPT" | base64 -w0)
EX=$(gcloud run jobs execute prooflab-prod-readonly-audit --project=$P --region=$R --wait \
     --args="-c,echo $B | base64 -d | bash" --format="value(metadata.name)")
gcloud logging read "resource.type=\"cloud_run_job\" AND labels.\"run.googleapis.com/execution_name\"=\"$EX\"" \
  --project=$P --limit=3000 --order=asc --format="value(textPayload)" > docs/closure/prod-audit-output.txt

# remove the temporary job
gcloud run jobs delete prooflab-prod-readonly-audit --project=$P --region=$R --quiet
```

## 2. Restore drill (G02) - temporary clone, never touches production

```bash
P=prooflab-508214; R=asia-south1
T0=$(date -u +%FT%TZ)
# point-in-time clone of production into a NEW temporary instance (production is not changed)
gcloud sql instances clone prooflab-db prooflab-restore-drill --project=$P \
  --point-in-time="$(date -u -d '-15 minutes' +%FT%TZ)"
T1=$(date -u +%FT%TZ); echo "restore start $T0 end $T1"

# verify the clone with the same read-only SQL: same job pattern, the clone's socket,
# the production URI with only its instance name swapped inside the container
gcloud run jobs create prooflab-restore-drill-check --project=$P --region=$R \
  --image=postgres:17 --service-account=135298577404-compute@developer.gserviceaccount.com \
  --set-cloudsql-instances=$P:$R:prooflab-restore-drill --set-secrets=DB_URI=prooflab-db-uri:latest \
  --command=bash --args="-c,echo ready" --max-retries=0 --task-timeout=600 --quiet
SQLB64=$(base64 -w0 docs/closure/PROD-READONLY-AUDIT-2026-09-30.sql)
SCRIPT="echo $SQLB64 | base64 -d > /tmp/q.sql; U=\$(printf '%s' \"\$DB_URI\" | sed 's/prooflab-db\\b/prooflab-restore-drill/g'); PGOPTIONS='-c default_transaction_read_only=on' psql \"\$U\" -X -q -A -t -F ' | ' -f /tmp/q.sql 2>&1; echo __EXIT=\$?"
B=$(printf '%s' "$SCRIPT" | base64 -w0)
EX=$(gcloud run jobs execute prooflab-restore-drill-check --project=$P --region=$R --wait \
     --args="-c,echo $B | base64 -d | bash" --format="value(metadata.name)")
gcloud logging read "resource.type=\"cloud_run_job\" AND labels.\"run.googleapis.com/execution_name\"=\"$EX\"" \
  --project=$P --limit=3000 --order=asc --format="value(textPayload)" > docs/closure/restore-drill-output.txt

# clean up (the clone costs money while it exists)
gcloud run jobs delete prooflab-restore-drill-check --project=$P --region=$R --quiet
gcloud sql instances delete prooflab-restore-drill --project=$P --quiet
```

Expected: both outputs start with `S0 | prooflab | ... | on | PostgreSQL 17...` and end with `END`.

## 3. GitHub security settings (G15) - public repository

```bash
R=repos/manitejakanuri1/prooflaab
# free for public repos: secret scanning + push protection, vulnerability alerts, Dependabot security fixes
gh api -X PATCH $R -F "security_and_analysis[secret_scanning][status]=enabled" \
  -F "security_and_analysis[secret_scanning_push_protection][status]=enabled"
gh api -X PUT $R/vulnerability-alerts
gh api -X PUT $R/automated-security-fixes
# main: the CI 'test' check must pass (also for admins), no force-push, no deletion.
# Push the branch first (runs 'test'), then fast-forward main - the same SHA already passed.
cat > /tmp/prot.json <<'JSON'
{"required_status_checks":{"strict":false,"contexts":["test"]},"enforce_admins":true,
 "required_pull_request_reviews":null,"restrictions":null,"allow_force_pushes":false,"allow_deletions":false}
JSON
gh api -X PUT $R/branches/main/protection --input /tmp/prot.json
```
Rollback: `gh api -X DELETE $R/branches/main/protection`.

## 4. Restrict the public browser API key (G27)

The site key (`prooflab-web`, also in functions `GOOGLE_API_KEY`) has no restrictions. It is only used for
Identity Toolkit + Secure Token (browser `src/integrations/google/identity.ts`, functions `_shared/backend.ts`).

```bash
P=prooflab-508214
K=$(gcloud services api-keys list --project=$P --filter="displayName=prooflab-web" --format="value(name)")
gcloud services api-keys update "$K" --project=$P \
  --api-target=service=identitytoolkit.googleapis.com --api-target=service=securetoken.googleapis.com
# verify: sign in on prooflab.co.in and run: python scripts/healthcheck.py   (expect 24/24)
```
Rollback: `gcloud services api-keys update "$K" --project=$P --clear-restrictions`.

## 5. Company / recruiter TEST account (G10) - normal sign-up path

The password secret already exists (`prooflab-company-test-password`, created by the assistant, never printed).
```bash
# 1. sign up through the live form (Sign Up tab -> Company -> "ProofLab TEST Company")
PW="$(gcloud secrets versions access latest --secret=prooflab-company-test-password)"
EMAIL=vidyuthsetu+company01@gmail.com PASSWORD="$PW" node scripts/dev-tools/company_signup_browser.mjs https://prooflab.co.in
# 2. click the verification link sent to vidyuthsetu+company01@gmail.com (your Gmail)
# 3. approve the company in Admin -> People -> Companies (if it shows as pending)
# 4. run the matrix again - the company rows become real checks
python scripts/dev-tools/authz_matrix_check.py
```

## 6. Migration 49 - college-only reports (G28, privacy) - schema change, needs your yes

Rehearsed on staging inside a rolled-back transaction: every check passed. Apply staging first, then production.
```bash
P=prooflab-508214
# staging (through the existing staging inspector job, as in the rehearsal) - or Cloud SQL Studio on prooflab-staging-db
# production:
gcloud sql backups create --instance=prooflab-db --project=$P --description="pre-migration-49-college-reports"
gcloud storage cp migration/49-college-reports-college-only.sql gs://prooflab-508214_cloudbuild/sql/49-college-reports-college-only.sql
gcloud sql import sql prooflab-db gs://prooflab-508214_cloudbuild/sql/49-college-reports-college-only.sql --database=prooflab --user=postgres --project=$P --quiet
python scripts/dev-tools/authz_matrix_check.py     # expect: student tpo_* rows now refused
python scripts/healthcheck.py                      # expect 24/24 (college insights still work)
```
Rollback: re-run the previous definitions from supabase/migrations/20260823000100_stage24_insights_branch_trend_season.sql and
20260910000100_stage38b_shortlist_stage_timestamp.sql (only the `cid` line differs).

## 7. Staging robot must not administer production logins (G06)

```bash
P=prooflab-508214
gcloud projects remove-iam-policy-binding $P \
  --member="serviceAccount:prooflab-staging-accounts@$P.iam.gserviceaccount.com" --role=roles/identitytoolkit.admin
```
Effect: staging "remove student" / "set-password link" stop working (staging tests mint their own tickets and do not
need them). Real fix: a separate staging GCP project or Identity Platform tenant. Rollback: add-iam-policy-binding with the same role.

## 8. Remove Editor from runtime services (G05) - one service at a time

Dependency graph (verified from code + live config, 1 Oct 2026):

| Runtime | Needs (and nothing more) |
|---|---|
| prooflab-api (PostgREST) | roles/cloudsql.client (condition: prooflab-db); secretAccessor on prooflab-db-uri, prooflab-jwt-secret |
| prooflab-auth-bridge | secretAccessor on prooflab-jwt-secret (Google JWKS are public) |
| prooflab-files | roles/storage.objectAdmin on gs://prooflab-private-508214 and gs://prooflab-public-508214 (GCS mounts); secretAccessor prooflab-jwt-secret |
| prooflab-functions | objectAdmin on both buckets (mounts); secretAccessor on code-runner-secret, deepseek-api-key, github-pat, prooflab-jwt-secret, resend-api-key, webhook-secret; roles/cloudtasks.enqueuer on queue prooflab-transcription; roles/iam.serviceAccountUser on prooflab-tasks-invoker |
| prooflab-transcriber | secretAccessor prooflab-jwt-secret |
| prooflab-accounts | roles/identitytoolkit.admin (deletes/syncs logins, makes set-password links); secretAccessor prooflab-jwt-secret, webhook-secret |
| job prooflab-bug-finder | secretAccessor prooflab-jwt-secret, prooflab-smoke-student-password, prooflab-college-password, prooflab-admin-password |
| job prooflab-crawler | secretAccessor on the secrets it references (check `gcloud run jobs describe prooflab-crawler`) |
| Scheduler -> Cloud Run jobs (oauth) | roles/run.invoker on jobs prooflab-bug-finder and prooflab-crawler |
| Cloud Build (compute SA) | keeps cloudbuild.builds.builder + artifactregistry.writer; not a runtime |

Pattern for each service (example: transcriber, the smallest):
```bash
P=prooflab-508214; R=asia-south1; SA=prooflab-rt-transcriber@$P.iam.gserviceaccount.com
gcloud iam service-accounts create prooflab-rt-transcriber --project=$P --display-name="runtime: prooflab-transcriber"
gcloud secrets add-iam-policy-binding prooflab-jwt-secret --project=$P --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
gcloud projects add-iam-policy-binding $P --member=serviceAccount:$SA --role=roles/logging.logWriter
gcloud run services update prooflab-transcriber --project=$P --region=$R --service-account=$SA
python scripts/healthcheck.py && python scripts/dev-tools/attack_surface_check.py   # smoke
# rollback: gcloud run services update prooflab-transcriber --project=$P --region=$R \
#             --service-account=135298577404-compute@developer.gserviceaccount.com
```
Order: transcriber -> auth-bridge -> api -> files -> accounts -> functions (then a voice recording + written submit)
-> bug-finder job -> crawler job -> scheduler oauth identity. Only when nothing runtime uses the compute SA:
`gcloud projects remove-iam-policy-binding $P --member=serviceAccount:135298577404-compute@developer.gserviceaccount.com --role=roles/editor`
then `gcloud builds submit` a no-op build to prove Cloud Build still works.

## 9. firebase-adminsdk-fbsvc token creator (G08)
Firebase created this account; its project-wide `roles/iam.serviceAccountTokenCreator` lets it mint tokens as any
account. Nothing in this repository uses the Firebase Admin SDK. Review in the Firebase console
(Project settings -> Service accounts) and remove the role if no Firebase feature you use needs it:
`gcloud projects remove-iam-policy-binding prooflab-508214 --member=serviceAccount:firebase-adminsdk-fbsvc@prooflab-508214.iam.gserviceaccount.com --role=roles/iam.serviceAccountTokenCreator`
