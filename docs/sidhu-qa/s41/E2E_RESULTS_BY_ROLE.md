# E2E results by role (13 Oct 2026)

Source of the rows: `FULL_FUNCTIONALITY_MATRIX.csv` (1,292 rows from the control inventory, 75 screens).
Live signed-in results: **none yet**. Recruiter signs in as Company (`startup`); `/recruiter/dashboard` opens the
Company dashboard, so it has no separate rows.

| Role | Screens | Rows | Signed-out (LIVE, staging 59235dd) | Signed-in (LIVE) | Offline / static coverage |
|---|---|---|---|---|---|
| Student (new + established) | 25 | in matrix | every screen sends a visitor to sign-in, no data: PASS | **BLOCKED** | self-deletion, consent, squads, identity faults |
| College / TPO | 16 | in matrix | PASS | **BLOCKED** | squads 108 (incl. concurrency), Branch dropdown contract, removal |
| Company / Recruiter | 10 | in matrix | PASS | **BLOCKED** | voice consent (S36), identity faults (startup) |
| Admin | 24 | in matrix | PASS | **BLOCKED** | notification rules (107), identity faults (admin) |
| Anonymous | all | 68 API probes | 68 PASS, 0 FAIL; 46 closed routes 401 | n/a | anon API judge tests |

## What unblocks the signed-in rows (owner)

`node scripts/dev-tools/sidhu_s40_e2e_readiness.mjs` prints the exact list and commands. Today:

1. Create the environment: `gh api -X PUT repos/manitejakanuri1/prooflaab/environments/staging-e2e`.
2. Add 15 login secrets: `E2E_{ADMIN,TPO,COMPANY,STUDENT,ESTABLISHED}_{EMAIL,PASSWORD,USER_ID}` for staging-only test
   accounts (`gh secret set NAME --env staging-e2e`, gh prompts for the value).
3. Add 13 fixture secrets for the write pass (`E2E_FIXTURE_*`, `E2E_RESEND_READ_KEY`).
4. Add 3 disposable-identity secrets for the deletion pass, only with an isolated staging Identity tenant.
5. Variables `QA_WIF_PROVIDER`, `QA_SERVICE_ACCOUNT` (read-only QA Google identity) for revision and database proof.
6. TEJA: deploy the release SHA to staging (site + functions, web-bff, accounts, files) and apply 110 and 111.
