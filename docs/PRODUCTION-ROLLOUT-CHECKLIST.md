# Production rollout checklist

For the release candidate on `work/stabilization`. **Nothing here has been run.** Each stage needs the owner's yes. A stage that fails its check stops the rollout; use `PRODUCTION-ROLLBACK-CHECKLIST.md`.

Do it at a quiet hour (late evening IST, not between 05:30 and 06:00 when the nightly jobs run, and not Sunday night). Expect about 60–90 minutes with a short period where a few screens show an error.

---

## Stage 0 — Before the day

| # | Step | Who | Done when |
|---|---|---|---|
| 0.1 | Request Cloud Run CPU quota increase for `asia-south1` (ask for 100 vCPU) | Owner (console: IAM & Admin → Quotas → "Total CPU allocation, per project per region") | Approved by Google |
| 0.2 | Decide the monthly budget and update the budget alert | Owner | New amount set |
| 0.3 | Confirm GitHub emails you when a deploy fails | Owner | Yes |
| 0.4 | Re-run the staging gate: `bash scripts/dev-tools/staging_release_gate.sh` | Claude | `RELEASE GATE: PASS` |
| 0.5 | Remove the 15,000 synthetic students from staging if no more load tests are planned | Claude | optional |

## Stage 1 — Freeze and back up (owner: yes/no)

| # | Step | Check |
|---|---|---|
| 1.1 | `python scripts/healthcheck.py` on production | all PASS (the "before" picture) |
| 1.2 | On-demand Cloud SQL backup of `prooflab-db` | backup listed, time noted |
| 1.3 | Save the current production bodies of `recruiter_home`, `recruiter_talent`, `recruiter_proof_profile`, `record_activity`, `remove_students`, `assign_todays_lots`, `tpo_students`, `tpo_student_profile`, `form_squads`, `get_leaderboard`, `company_submissions`, `recruiter_lots` to a file (they differ from staging) | file saved; it is the rollback for 59, 64, 65, 68 |
| 1.4 | Note the running image of every production service (`infra/production/services.json` has them) | noted |
| 1.5 | `python scripts/infra_snapshot.py --check` | no drift from the recorded state |

## Stage 2 — Database (owner: yes/no — production migration)

Apply **in this order**, each through the ledger (same wrapper as staging, pointed at production), stopping at the first failure. Every file has its own self-check and rolls itself back if the check fails.

`50 → 51 → 52 → 53 → 54 → 55 → 56 → 57 → 57b → 58 → 59 → 60 → 61 → 62 → 63 → 64 → 65 → 67 → 68`

- **Not 66** (it deletes; separate stage 7).
- **Never 46** (superseded by 64).
- 67 creates the ledger; record 50–65 in it as they are applied.
- Expected side effects while the OLD website is still live (a few minutes): company "sponsor a Lot" button fails (56), "Explain" before "Submit" is refused with a message (61), "delete recording" in Privacy fails (61).

Check after: `notify pgrst, 'reload schema'`; production API answers; ledger lists 19 files.

## Stage 3 — Services (owner: yes/no — production deploy)

Deploy the **same images that passed on staging** (they are in the shared registry; do not rebuild):

| Service | Image tag proven on staging | New settings |
|---|---|---|
| functions | latest `stab-…` on `prooflab-staging-functions` | none yet |
| files | latest `stab-…` on `prooflab-staging-files` | none yet |
| accounts | `stab-531b2ab-1325` | none yet |
| transcription-worker | `stab-531b2ab-…` | none yet |
| transcriber | `stab-531b2ab-1327` | none yet |
| auth-bridge | `stab-531b2ab-1314` | none yet |
| code-runner | `stab-w3a` | none |

With no new settings every service behaves as before on tokens (the new code is backward compatible). Check after each: `/ready` (functions must say **32 of 32**).

## Stage 4 — Website (owner: yes/no — merge to `main`)

1. Merge `work/stabilization` into `main`. The push starts the release gate, then the deploy.
2. **Watch the deploy job** — it is the first run of the new "publish the tested build" step. If it fails at "download artifact", revert `.github/workflows/deploy.yml` to the previous version and push.
3. Check: `prooflab.co.in` serves the new bundle (the job prints it).

## Stage 5 — Checks (Claude)

| # | Check | Pass |
|---|---|---|
| 5.1 | `python scripts/healthcheck.py` | all PASS |
| 5.2 | `python scripts/dev-tools/attack_surface_check.py` | all PASS |
| 5.3 | `python scripts/dev-tools/authz_matrix_check.py` | all PASS |
| 5.4 | Bug finder: `gcloud run jobs execute prooflab-bug-finder --wait` | all steps pass |
| 5.5 | Smoke student signs in, sees today's Lot, submits, is asked to explain, recording appears in Build-log scored | row in `voice_explanations` with `submission_id` and `current_authoritative` |
| 5.6 | Next morning: `daily-lots` log shows `failed: 0` | yes |

## Stage 6 — Token signing cutover (owner: yes/no — production auth change)

Do this on a later day, after stages 2–5 have been quiet for 24 hours.

1. Create the production signing key in Secret Manager; allow only `prooflab-rt-authbridge` to read it.
2. Bridge: set `APP_SIGNING_KEY`, `SERVICE_TOKEN_AUDIENCE`, `SERVICE_TOKEN_CALLERS` (functions, accounts, worker, bug-finder, crawler robots).
3. API: key set = bridge public key **plus** the old key ("transition"). Signed-in people keep working.
4. Functions, files, accounts, worker, transcriber: set `APP_JWT_PUBLIC_JWKS` and `SIGNER_URL`; functions and files get `FILE_GRANT_SECRET`.
5. Bug finder and crawler jobs: set `SIGNER_URL`. Replace the GitHub crawl workflow's secret with Google sign-in, or retire that workflow (the Cloud Run crawler job already exists).
6. Wait at least 2 hours (old tickets live 1 hour).
7. API: key set = bridge public key only. Remove `PGRST_JWT_SECRET` from every service.
8. Run the production equivalents of the F1 check. Old-style tokens must be refused.

## Stage 7 — Permanent cleanup (owner: yes/no — permanent deletion)

Only after stage 4 has been live for at least a week.

1. Fresh backup (same hour).
2. Apply `66-retire-proof-era-objects.sql`. It refuses to run if anything still depends on what it drops, and copies every row into `legacy_archive` first.
3. Old proof files in storage: count them first, show the owner the count, then decide.

## Stage 8 — Follow-ups that also need a yes

| Item | Kind |
|---|---|
| Voice queue retry window (8 tries / 2 min max backoff) and worker `QUEUE_MAX_ATTEMPTS=8` | production queue + service setting |
| Worker maximum instances (currently unlimited) | production service setting |
| Alerts for the new log lines | monitoring |
| Scheduler jobs on Google identity instead of the webhook secret | production Scheduler change |
| Deep bug-finder as its own job | production Scheduler change |
| Protected test logins in production | production data |
