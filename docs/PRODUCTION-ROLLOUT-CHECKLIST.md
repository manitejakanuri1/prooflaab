# Production rollout checklist

For the release candidate on `work/stabilization`. **Nothing here has been run.** Every stage needs the owner's yes. A stage that fails its check stops the rollout; use `PRODUCTION-ROLLBACK-CHECKLIST.md`.

What ships is listed exactly in `RELEASE-MANIFEST.md` (commit, image digests, migration checksums). Production must receive those artifacts, not rebuilt ones.

Do it at a quiet hour (late evening IST; never 05:30–06:00 when nightly jobs run; not Sunday night). About 90 minutes, with a few minutes where some buttons show an error.

---

## Stage 0 — Before the day

| # | Step | Who |
|---|---|---|
| 0.1 | Release target is 2,000 students on the current 20-vCPU quota; no quota request in this release. Read `CONCURRENCY-2000-REPORT.md` for the measured limit before choosing the rollout day | Owner |
| 0.2 | Decide the monthly budget (`COST-CONTROL-PLAN.md`) | Owner |
| 0.3 | Decide XP timing (report §12) — no change is needed to roll out | Owner |
| 0.4 | Rehearse Stage 2 on a temporary copy of production (restore the latest backup into a throw-away Cloud SQL instance, run the whole sequence, delete it). **Done 6 Oct 2026 (backup 1791144000000): Option 2 passed; it found 82b, 84a, 86b, 86c.** Must be repeated with the exact final files of the release commit on the newest backup before Stage 1. | Owner yes, Claude runs |
| 0.5 | `bash scripts/dev-tools/staging_release_gate.sh` → `FINAL STAGING RELEASE GATE: PASS` | Claude |

## Stage 1 — Freeze and back up

| # | Step | Check |
|---|---|---|
| 1.1 | `python scripts/healthcheck.py` | all PASS (the "before" picture) |
| 1.2 | On-demand Cloud SQL backup of `prooflab-db` | listed; time noted |
| 1.3 | Save the current production bodies of every function this release replaces: `recruiter_home`, `recruiter_talent`, `recruiter_proof_profile`, `record_activity`, `remove_students`, `assign_todays_lots`, `tpo_students`, `tpo_student_profile`, `form_squads`, `get_leaderboard`, `company_submissions`, `recruiter_lots`, `task_default_checker`, `guard_voice_explanations_insert`, `next_lot_source`, `seed_lot_template`, `create_lot_for`, `my_todays_lot`, `protect_tasks`, `record_task_submission`, `cosignable_proofs`, `set_proof_publicity`, and every function 80–87 re-grants (simplest: all public functions, as the rehearsal did: 274 bodies + triggers + grants) | one file; it is the production rollback for 53, 59, 61, 64, 65, 68, 74, 84a, 88, 91 |
| 1.4 | `python scripts/infra_snapshot.py --check` | production matches `infra/production/` |

## Stage 2 — Database

### How the ledger starts (resolved)

Production has no `schema_migrations` table. The apply wrapper (`python scripts/migrations.py wrap <file>`, used by `staging_migrate.sh`) **creates the ledger table itself, if it is missing, before it applies any file**. So:

1. The first file (50) is applied through the wrapper. The wrapper creates the empty ledger, runs 50, and records `50-…` with its checksum **only after the file has committed**.
2. Files 51–65 follow the same way. Nothing is ever recorded that was not run.
3. Migration 67 (which "creates" the ledger) then finds the table already there (`create table if not exists`), adds its access rules, and is recorded like any other file.
4. Migrations 1–49 are **not** recorded: they predate the ledger and are known applied (49 was verified on 1 Oct). The ledger answers "which stabilization files does this database have", starting at 50.
5. Preflight, before 50: `select to_regclass('public.schema_migrations')` must be empty, and `select to_regprocedure('public.account_email_confirmed(uuid)')` must be empty (proves 51+ are really absent). If either exists, stop and find out why.

What happens when something goes wrong:

| Case | What the wrapper does | What to do |
|---|---|---|
| A file's own self-check fails | the file rolls itself back; no ledger row | fix the cause, run the same file again |
| A file was changed after it was applied somewhere | refuses: "changed after it was applied (ledger checksum differs)" | never edit an applied file; write a new one |
| A file is run twice | "already applied - skipped" | nothing |
| The file committed but the ledger row was not written (connection lost between the two) | next run applies it again. Every file is safe to repeat except the three drop files (66, 71, 72), which stop at their first statement | for those three, insert the row by hand with the checksum from `python scripts/migrations.py plan` |

Production function bodies that differ from staging: 59, 64, 65, 68 and 74 replace whole functions on purpose (the new bodies are the intended ones). Production's old bodies are kept by Stage 1.3 for rollback. Migration 46 is superseded by 64 and must never be applied.

### Order

Apply through the wrapper, one at a time, stopping at the first failure:

`50 → 51 → 52 → 53 → 54 → 55 → 56 → 57 → 57b → 58 → 59 → 60 → 61 → 62 → 63 → 64 → 65 → 67 → 68 → 69 → 70 → 73 → 74 → 77 → 75 → 76 → 79 → 80 → 81 → 82 → 82b → 83 → 84 → 84a → 85 → 86 → 86b → 86c → 87 → 88 → 89 → 90 → 91`

This is "Option 2", proved on a restored production copy (Stage 0.4, 6 Oct 2026). Production-only needs found there:
- **82b before 83**: production has no default privileges for the backend role; without 82b, 83 refuses.
- **84a before 85**: two old proof functions still exist on production (66 is deferred); without 84a, 85 refuses.
- **86b before 87**: production lets only the owner read `account_identities`; without 86b, 87 refuses.
- **86c before the new functions image**: without it `company-lot` refuses every company Lot on production.
- **91**: a coding submission is "passed" only when every test passed (score stays the partial score).
- Option 1 (66 before 85) is NOT possible: 87's table-count check fails after 66 on production.

- **74 and 77 always together** (74 alone breaks the creation of new Lots).
- **Not 66, 71, 72** — they delete; Stage 7. 71 and 72 refuse to run before 66.
- After 73: nothing changes until the API setting in Stage 3 turns the check on.

Effects while the OLD website and functions are still live (keep this gap to minutes: Stage 3 and 4 follow immediately): the company "sponsor a Lot" button fails (56, and `sponsor_lot` is removed by 74), "Explain" before "Submit" is refused with a message (61), "delete recording" in Privacy fails (61), the old verification screen's admin notification fails (82 locks `notify_all_admins`), a coding Submit that fails a test is no longer passed (91).

Check after: API answers; `select count(*) from schema_migrations` = 42; `python scripts/migrations.py plan` checksums equal the ledger's.

## Stage 3 — Services

Deploy the exact images in `RELEASE-MANIFEST.md` by digest (do not rebuild), in this order, checking `/ready` after each:

| Order | Service | Settings to add now | Must say |
|---|---|---|---|
| 1 | api | `PGRST_DB_PRE_REQUEST=public.refuse_suspended` | answers; a suspended test account gets 403 |
| 2 | functions | none yet | **32 of 32** |
| 3 | files, accounts, auth-bridge | none yet | ready |
| 4 | transcriber, then transcription-worker | none yet | ready; one test recording is scored |
| 5 | code-runner (launch blocker: production runs the old `v1` image, open to `allUsers`) | see 3.1 below | ready, `net_isolation: true` |
| 6 | crawler job, bug-finder job | none yet | next scheduled run passes |

With no new settings the new code behaves as before on tokens, Scheduler and the runner (every identity feature is off until configured).

**One service at a time, a few minutes apart.** Each deploy starts new instances beside the old ones; until the CPU quota is raised, deploying several services at once can exhaust it and the new revision will not start (seen on staging). If a revision reports "Quota exceeded for total allowable CPU", wait two minutes and deploy the same image again — the old revision keeps serving meanwhile.

### 3.1 Code runner made private (moved here from Stage 6.3: required for launch)

Each step is checked before the next. Steps 1–6 keep the old path working, so nothing breaks while switching.

| # | Step | Check |
|---|---|---|
| 1 | Deploy the release runner image with `RUNNER_ALLOWED_CALLERS=prooflab-rt-functions@prooflab-508214.iam.gserviceaccount.com` **and** the old `RUNNER_SECRET` still set | `/ready` shows `net_isolation: true` |
| 2 | Grant `roles/run.invoker` on the runner to `prooflab-rt-functions@…` | IAM policy lists it (and still `allUsers`) |
| 3 | Functions: `CODE_RUNNER_AUTH=iam` (keep `CODE_RUNNER_SECRET` for now) | `/ready` 32/32 |
| 4 | Smoke student: Run samples, then Submit (hidden tests) on a coding task | Run shows results; Submit stores one submission |
| 5 | A call with any other Google identity | 401 from the runner |
| 6 | Remove `allUsers` from the runner | anonymous POST /run and GET /ready: 403 |
| 7 | Remove `RUNNER_SECRET` from the runner and `CODE_RUNNER_SECRET` from functions | Run + Submit again work |

Rollback for each step: undo that step only (add `allUsers` back, set `CODE_RUNNER_AUTH` unset, redeploy the previous runner revision).

### 3.2 Google sign-in key restricted

The website's sign-in key `prooflab-web` (`ad12f17e-…`, used by the browser and by functions) has no restrictions. It is public by design (it ships in the website), so Secret Manager would not protect it; restricting it does. After Stage 4:
`gcloud services api-keys update ad12f17e-f53b-4307-b745-acbd109eb8b2 --api-target=service=identitytoolkit.googleapis.com --api-target=service=securetoken.googleapis.com`
Check: sign in, sign out, password reset mail, and `bash scripts/check-google-auth.sh`. Rollback: `gcloud services api-keys update ad12f17e-f53b-4307-b745-acbd109eb8b2 --clear-restrictions`. Note: staging uses the same key, so this also changes staging.

## Stage 4 — Website

1. Merge `work/stabilization` into `main`. The gate runs, the `artifact-handoff` job verifies the build, then `deploy` publishes that same build.
2. Check: `prooflab.co.in` serves the new bundle (the job prints it); menus show four items per role.

## Stage 5 — Checks

| # | Check | Pass |
|---|---|---|
| 5.1 | `python scripts/healthcheck.py` | all PASS |
| 5.2 | `python scripts/dev-tools/attack_surface_check.py`, `authz_matrix_check.py` | all PASS |
| 5.3 | Bug finder: `gcloud run jobs execute prooflab-bug-finder --wait` | all steps pass |
| 5.4 | Smoke student: Floor → Lot → Submit → "Please speak in English only" → record → Build-log shows Task result and Voice explanation | a `voice_explanations` row with `submission_id`, `current_authoritative`, `evaluation.transcription.language = en` |
| 5.5 | Next morning: `daily-lots` log shows `status: success` | yes |
| 5.6 | Create the production alerts: `python scripts/setup_alerts.py production --apply` | 15 created |

## Stage 6 — Identity cutover (a later day, after 24 quiet hours)

One step at a time; each has its own rollback.

| # | Step |
|---|---|
| 6.1 | **Tokens (F1).** Create the production signing key in Secret Manager, readable only by the bridge's account. Bridge: `APP_SIGNING_KEY`, `SERVICE_TOKEN_AUDIENCE`, `SERVICE_TOKEN_CALLERS`. API: key set = bridge public key **plus** the old key. Services: `APP_JWT_PUBLIC_JWKS`, `SIGNER_URL`; functions and files: `FILE_GRANT_SECRET`. Jobs: `SIGNER_URL`. Replace or retire the GitHub crawl workflow (it holds a copy of the old key). Wait 2 hours. API: public key only; remove `PGRST_JWT_SECRET` from every service. Old-style tokens must now be refused. |
| 6.2 | **Scheduler (G11).** Functions: `SCHEDULER_CALLERS=prooflab-rt-scheduler@…`, `SCHEDULER_AUDIENCE=<functions URL>`. Change each of the 9 webhook jobs to send an identity token for that audience and no secret header (production Scheduler change). When all 9 have run green once: `SCHEDULER_AUTH=oidc`. |
| 6.3 | **Code runner (G12).** Moved to Stage 3.1 (launch blocker). |

## Stage 7 — Permanent cleanup (at least a week after Stage 4)

1. Fresh backup, same hour.
2. `66` (11 proof-era tables, 8 functions, `trust_score`), then `71` (two unused columns), then `72` (`task_applications`). Each refuses to run if anything still depends on what it drops and copies every row to `legacy_archive` first.
3. Old proof files in storage: count them, show the owner, then decide.
4. Regenerate `src/integrations/supabase/types.ts`; update `authz_matrix_check.py`.

## Stage 8 — Also needs a yes

| Item | Kind |
|---|---|
| Worker maximum instances = 4; API database pool and database tier | production service settings |
| Voice queue: 8 attempts, up to 2 minutes apart; worker `QUEUE_MAX_ATTEMPTS=8` | production queue + setting |
| Deep bug-finder as its own job | production Scheduler |
| Protected test logins in production | production data |
