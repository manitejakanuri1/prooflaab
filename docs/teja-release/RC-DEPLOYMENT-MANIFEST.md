# Release candidate: deployment manifest

Date: 9 October 2026. Branch: `fix/teja-claude-s33-launch-rc-2026-10-09`. Parent commit: `851cf7ecca4ff92be2e1507cca9476a33c057728`.

The release candidate is **the commit that contains this file**. Its id is printed by `git log -1 --format=%H` on the branch; approve by that full id, nothing else.

**Nothing in this file has been run.** Every numbered step needs the owner's yes. No step here is approved by the existence of this file. Detail and evidence: `S33-FINAL-LAUNCH-RELEASE-CANDIDATE.md`.

## 1. What ships

| Part | Built from | Changed in this candidate? | Deploy rule |
|---|---|---|---|
| Website | repo root (`npm run build`) | Yes | CI builds it once; that same build is published. Never a laptop build. |
| Web gateway (`web-bff/`) | `web-bff/` | Yes: signed-out portfolio route | Build once from the candidate commit, prove on staging, deploy to production **by digest** |
| Server functions | `functions-service/`, `supabase/functions/` | Yes: `submit-sandbox-task`, `submit-written-task`, `_shared/submission.ts` | Same. **Only after migration 103.** |
| Auth bridge, files, accounts, transcriber, transcription worker, code runner | their folders | No source change in this candidate | Per `docs/PRODUCTION-ROLLOUT-CHECKLIST.md` Stage 3 |
| Database | `migration/` | Yes: 103 added | Section 2 |
| Hosting rewrite | `scripts/deploy-hosting.py`, `scripts/hosting_rewrites.py` | Yes: same output, now tested | `/api/**` to the gateway first, app page last |

Staging note: the functions canary `prooflab-staging-functions-00075-git` (tag `s30v2`) was built from the working tree before this commit existed. The functions source in this commit is the same content. Its image digest must be written into section 6 at promotion time; that digest is what production receives.

## 2. Migration order

Production state is **not verified**. Read it first (read-only): `select to_regclass('public.schema_migrations');` then the ledger rows. Never apply on a guess.

1. Files 50 to 91: the exact order in `docs/PRODUCTION-ROLLOUT-CHECKLIST.md`, Stage 2 (proved twice on a restored production copy).
2. Then, one at a time through the wrapper (`python scripts/migrations.py wrap <file>`), stopping at the first failure:

| Order | File | sha256 (from `python scripts/migrations.py plan`) | Needed for |
|---|---|---|---|
| 1 | `92-function-mode-foundation` | `f171b6d346cdd2809285739a8973ab42949e8b695f83fa375678f8f6c08591ec` | Coding checks |
| 2 | `93-coding-pass-counts-hidden-summary` | `e032705812cf8fd6bae4b3f52413446d5fcdcb812f39fb64deb663b178166143` | Coding pass rule |
| - | `94-drop-unused-verification-and-adjustment-tables` | `abd1ad005c1d7199ff678cb208e79262e26838d568080501c112d56d1ef65746` | **Not needed for launch. It deletes two tables. Own yes required. Skip unless approved.** |
| 3 | `95-web-sessions` | `d49080ac2f528988868b4f15ee3cd9e418069ebb50de3b7cf08757f81f1572c6` | Gateway sessions |
| 4 | `96-managed-login-sessions` | `090bc9d15a95064c9096c9e623b1759a883c9ea15ecc890580b89dc4ab87b60b` | Gateway sign-in |
| 5 | `97-managed-account-provisioning` | `bed7ade3e594848cb9d9c2b3117fe687a8a049f0255aa93bfb2ff31920c8d9c7` | Admin-created accounts |
| 6 | `98-managed-college-provisioning` | `39220768d10fafc7eb0e97ac5b7f21f961e8a3a30320e13a981bee5fe536dc9e` | College accounts |
| 7 | `100-managed-accounts-only-policies` | `7cb42c0864e0df559310eb30d79e264a0dc17157266336a502237e7630479581` | Required by 103 |
| 8 | `101-revoke-sessions-when-access-ends` | `aac471290ef2733623e67d03506bbd531fb1c4e872e620acbd9e7f6ef71507a3` | Session revocation |
| 9 | `102-student-access-enforcement` | `9d3a1075353754405439f7e19fa0576a551841bbebdad85e114a660267b3611a` | Requires 96 and 101 |
| 10 | `103-task-provenance-and-authz-repair` | `80a25b29dc675e11f84026a893bdf46c3ef414b2e8b4d5b8a0d7d22498588d6a` | Requires 100. **Before the functions.** |

There is no 99. If 94 is skipped, confirm with a rehearsal on a restored copy that 95 onward do not expect it (they do not reference the two tables, but this was not rehearsed).

Check after each file: its own self-check passes; the ledger row's checksum equals the table above.

## 3. Launch order (production)

```
A  Backup of prooflab-db; drift items closed
B  Database: section 2
C  Services by digest (checklist Stage 3); functions after 103
D  Token change, first half: bridge signs with its own key; API accepts new AND old keys;
   verifying services get the public key
E  Gateway: section 4
F  Owner sets the three release variables for the candidate's full commit id
G  Website: merge to main; CI runs the release guard, then publishes
H  Checks: section 7 (production column)
```

`docs/PRODUCTION-ROLLOUT-CHECKLIST.md` has G before D and no gateway. For this candidate use the order above.

## 4. Production gateway prerequisites and commands

Checked live on 9 October (read-only): the service `prooflab-web-bff` does not exist; the production bridge has no `APP_SIGNING_KEY`, no `SERVICE_TOKEN_AUDIENCE`, no `SERVICE_TOKEN_CALLERS`.

| # | Prerequisite | Proof |
|---|---|---|
| P1 | Migrations 95, 96, 101, 102 applied | ledger |
| P2 | Step D done: bridge `/ready` reports `alg: RS256`; existing sign-in still works | bridge `/ready`; smoke sign-in |
| P3 | Account `prooflab-rt-webbff` exists with **no project roles** | IAM policy |
| P4 | Secret `prooflab-web-bff-session-key` exists; only that account can read it; it is not the staging key | secret IAM policy |
| P5 | That account is in the bridge's `SERVICE_TOKEN_CALLERS`; no staging account is | bridge settings |
| P6 | The gateway image digest is the one proven on staging | section 6 |

Commands (confirm limits and setting names against the live staging gateway first):

```bash
P=prooflab-508214; R=asia-south1; SA=prooflab-rt-webbff@$P.iam.gserviceaccount.com

gcloud iam service-accounts create prooflab-rt-webbff --project $P --display-name "ProofLab web gateway"

python -c "import secrets,sys; sys.stdout.write(secrets.token_urlsafe(32))" | \
  gcloud secrets create prooflab-web-bff-session-key --project $P --replication-policy automatic --data-file=-
gcloud secrets add-iam-policy-binding prooflab-web-bff-session-key --project $P \
  --member serviceAccount:$SA --role roles/secretmanager.secretAccessor

gcloud run deploy prooflab-web-bff --project $P --region $R \
  --image <gateway image @sha256 digest from section 6> \
  --service-account $SA --allow-unauthenticated \
  --cpu 1 --memory 512Mi --timeout 60 --max-instances <same as staging> \
  --set-secrets SESSION_KEY=prooflab-web-bff-session-key:1 \
  --set-env-vars "^|^GOOGLE_API_KEY=<public browser key from .env.production>|AUTH_BRIDGE_URL=<bridge address, exactly equal to its SERVICE_TOKEN_AUDIENCE>|POSTGREST_URL=<prooflab-api>|FUNCTIONS_URL=<prooflab-functions>|FILES_URL=<prooflab-files>|ACCOUNTS_URL=<prooflab-accounts>|TRANSCRIBER_URL=<prooflab-transcriber>|BROWSER_ORIGINS=https://prooflab.co.in,https://www.prooflab.co.in,https://prooflab-508214.web.app"
```

`BFF_RELEASE_READY` is not set by that command. Then, on the gateway's own address:

| # | Check | Expect |
|---|---|---|
| E1 | `/health` | 200 `{"ok":true,"service":"prooflab-web-bff"}` |
| E2 | `/ready` | 503 |
| E3 | `/api/auth/session`, `/api/db/profiles` | 200 `{"session":null}`, 401 |
| E4 | `gcloud run services update prooflab-web-bff --project $P --region $R --update-env-vars BFF_RELEASE_READY=true`, then `/ready` | 200, state `ready`. A named failure stops the launch. |
| E5 | `python scripts/dev-tools/production_bff_preflight.py` | all PASS except the two `site:` lines |
| E6 | Smoke student signs in on the gateway address | works |

Release variables (GitHub, repository variables, owner only): `PRODUCTION_BFF_SERVICE=prooflab-web-bff`, `PRODUCTION_BFF_HEALTH_URL=<gateway https run.app address>`, `PRODUCTION_RELEASE_APPROVED_SHA=<full 40-character candidate id>`.

## 5. Rollback commands

Write down these four values **before** the step they protect: current Hosting version id (production and staging), current revision of every service being changed, the backup id, the ledger's last row.

```bash
P=prooflab-508214; R=asia-south1

# Website (production): release the previous version again
curl -sS -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "X-Goog-User-Project: $P" \
  "https://firebasehosting.googleapis.com/v1beta1/sites/prooflab-508214/channels/live/releases?versionName=sites/prooflab-508214/versions/<PREVIOUS VERSION ID>"

# Gateway: close it without removing it
gcloud run services update prooflab-web-bff --project $P --region $R --remove-env-vars BFF_RELEASE_READY
# Gateway: back to an earlier revision (only once a second revision exists)
gcloud run services update-traffic prooflab-web-bff --project $P --region $R --to-revisions <GOOD REVISION>=100

# Any service: back to the previous revision
gcloud run services update-traffic <SERVICE> --project $P --region $R --to-revisions <PREVIOUS REVISION>=100

# Token change (step D): bridge back to the shared secret, API back to the old key
gcloud run services update prooflab-auth-bridge --project $P --region $R \
  --remove-secrets APP_SIGNING_KEY --remove-env-vars SERVICE_TOKEN_AUDIENCE,SERVICE_TOKEN_CALLERS
gcloud run services update prooflab-api --project $P --region $R --update-secrets PGRST_JWT_SECRET=prooflab-jwt-secret:latest

# Database: the file's own rollback, newest first, through the wrapper
#   migration/103-rollback-task-provenance-and-authz-repair.sql   (reopens the holes 103 closes: incident use only)
#   migration/102-rollback-..., 101-rollback-..., 100-rollback-..., 98-..., 97-..., 96-..., 95-..., 93-..., 92-...

# Staging: print the plan (runs nothing)
python scripts/dev-tools/staging_rollback_plan.py --stable-revision <REVISION> --site-version <VERSION ID>
```

Rules:

- Roll back the site before the gateway. The new site cannot work without the gateway; the old site does not need it.
- Functions may go back to the previous revision while 103 stays applied. Do **not** roll 103 back while the new functions serve.
- After a site rollback to the old build, users are on the old sign-in again. Nothing is lost.
- The token rollback commands are written from the recorded settings (`infra/production/services.json`). Rehearse them on staging before the day; they have not been run.

## 6. Values to record at promotion (empty until then)

| Item | Staging | Production |
|---|---|---|
| Candidate commit id | | |
| Gateway image digest | | |
| Functions image digest | | |
| Gateway revision before / after | | |
| Functions revision before / after | `…` / `prooflab-staging-functions-00075-git` | |
| Hosting version before / after | | |
| Ledger last row before / after | | |
| Backup id | | |

## 7. Staging acceptance checklist

All must be YES before any production step. "Seen" means a person or a saved result file, not a mock test.

| # | Check | Staging | Production (after step G) |
|---|---|---|---|
| 1 | CI green on the candidate commit, Docker steps included | | n/a |
| 2 | Ledger has 92, 93, 95 to 98, 100 to 103 with the checksums of section 2 | 93 and 103 reported applied and verified; the rest to confirm | |
| 3 | Functions: normal traffic on the new revision; `/ready` loaded equals expected | canary passed; traffic not yet moved | |
| 4 | Gateway built from the candidate commit; `/health` 200 | | |
| 5 | Gateway `/ready` 200 with the release switch on, against real backends | **never yet seen** | |
| 6 | `python scripts/dev-tools/staging_bff_preflight.py` all PASS (update the revision names in it first) | | `production_bff_preflight.py` all PASS |
| 7 | Site published from the CI build; `/api/auth/session` answers JSON, not the app page | | |
| 8 | Five roles sign in, land on the right dashboard, sign out (Student, College, Company, Admin, plus suspended refused) | Sidhu | smoke student only |
| 9 | Student: coding submission passes and is stored | PASSED (S4) | |
| 10 | Student: written submission passes and is stored | PASSED (S4B) | |
| 11 | Student: completed task, View Submission opens its Build-log entry | | |
| 12 | Student: backend outage shows the failure message, not a request loop | | |
| 13 | College: Assign Task to own student works; to another college's student is refused | | |
| 14 | Student cannot create a task for themself (103) | | |
| 15 | Signed-out portfolio: published one shows; private and unknown show "not found"; `/api/db/**` signed out is 401 | | |
| 16 | Four menus per dashboard unchanged | | |
| 17 | Rollback rehearsed once on staging: gateway traffic back, site version back | | n/a |
| 18 | `python scripts/healthcheck.py` | n/a | all PASS |

Not claimed anywhere in this candidate: that a real user has completed a journey in production. Only step H can show that.
