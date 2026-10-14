# Deploying ProofLab

Everything runs on Google Cloud, project `prooflab-508214`, region `asia-south1`.
**Vercel and Supabase are retired**: there is no Vercel project, no `vercel.json` deploy, no
`supabase db push`, no `supabase functions deploy`. (This file used to describe Vercel; it was
rewritten on 7 Oct 2026 from `.github/workflows/deploy.yml` and `docs/PRODUCTION-ROLLOUT-CHECKLIST.md`.)

There are three separate things to deploy. Each has its own path and its own approval.

| What | How it goes live | Who/what can do it |
|---|---|---|
| Website | push to `main` on `prooflaab` -> GitHub Actions -> Firebase Hosting | CI, after the gate passes |
| Server services (functions, auth-bridge, files, accounts, transcriber, worker, runner, jobs) | build an image, `gcloud run deploy` / `gcloud run jobs update` | an operator, with the owner's yes |
| Database | `migration/NN-*.sql` applied through the ledger wrapper | an operator, with the owner's yes |

A push to `main` deploys **only the website**. It never deploys functions or touches the database.

## 1. Website (automatic from `main`)

1. Work on a branch. Every push and pull request runs the `test` job:
   secret scan, legacy guard, migration consistency, website unit tests, typecheck,
   Deno tests and type-check of every function, auth-bridge / files / accounts tests,
   production build. The `code-runner` job builds and tests the runner image.
   The `artifact-handoff` job re-checks the uploaded build (checksums) and smoke-tests it.
2. Merge to `main` only when tested **and the owner has said yes**.
   Push to `prooflaab` only - never `origin`.
3. On `main` the `deploy` job (Google identity through Workload Identity, account
   `github-deploy@`, which may only publish to Hosting) downloads **the exact build the gate
   tested**, verifies `dist.sha256`, runs `python scripts/deploy-hosting.py`, and checks that
   `prooflab.co.in` serves the new entry script. About 5 minutes.
4. After: `python scripts/healthcheck.py` (all PASS) and the page walk
   (`scripts/dev-tools/walk.mjs`).

Rollback: re-run the deploy workflow on the previous good `main` commit
(Actions -> Deploy to production -> Run workflow), or revert the commit and push.

## 2. Server services (manual, approval needed)

- Functions: all handlers run in one service, `prooflab-functions` (`functions-service/main.ts`).
  A new function must be added to `SLUGS` there. After deploy, `/ready` must show
  loaded == expected.
- Images are recorded by digest in `docs/RELEASE-MANIFEST.md`. Deploy by digest, change one
  service at a time, and note the previous revision for rollback
  (`gcloud run services update-traffic <svc> --to-revisions=<previous>=100`).
- The code runner lives in its own project, `prooflab-runner-508214` (service
  `prooflab-code-runner-rc`, Cloud Run IAM, no secret). Functions reach it with
  `CODE_RUNNER_AUTH=iam`.
- Settings that are running now are recorded (read-only) by `python scripts/infra_snapshot.py`
  into `infra/<env>/*.json`.
- Every service has its own least-privilege robot account; nobody has Editor. A new secret or
  bucket a service needs must be granted to that service's robot.

## 3. Database (manual, approval needed)

1. Write `migration/NN-name.sql` with a `do $$` self-check (end with
   `notify pgrst, 'reload schema';` when adding functions or columns), its rollback file, and
   the identical copy in `supabase/migrations/`. `python scripts/migrations.py check` must pass.
2. Rehearse on **staging** first (`scripts/dev-tools/staging_sql.sh`, staging only).
3. Production: through the ledger wrapper (`python scripts/migrations.py wrap <file>`), one file at
   a time, after a same-hour Cloud SQL backup for anything that drops or rewrites data.
   Direct `psql` to production is blocked.

## Where the details are

- `docs/PRODUCTION-ROLLOUT-CHECKLIST.md` and `docs/PRODUCTION-ROLLBACK-CHECKLIST.md` - step by step.
- `docs/RELEASE-MANIFEST.md` - which commit, images and migration checksums are released.
- `docs/POST-RELEASE-REMAINING-WORK.md` - what is still open.
