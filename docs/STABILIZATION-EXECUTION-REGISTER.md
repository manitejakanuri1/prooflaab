# Stabilization execution register

Live register. One row per item; updated in the same commit as the work.
Statuses: `NOT_STARTED` · `IN_PROGRESS` · `STAGING_PASS` · `BLOCKED` · `PRODUCTION_PENDING` · `COMPLETE`.
**Production status for every item below is `PRODUCTION_PENDING` unless stated**: nothing from the stabilization branch is deployed to production.

Branch `work/stabilization` (pushed to `prooflaab`); rollback tag `stabilization-baseline-2026-10-03` → `d736e4d`.
Staging fixtures: `docs/STAGING-TEST-FIXTURES.md`. Staging SQL runner: `scripts/dev-tools/staging_sql.sh`.

| ID | Subsystem | Problem | Previous behaviour | Target behaviour | Status | Files | Migration | Staging proof | Automated test | Browser test | Rollback | Blockers |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F3 | AI / telemetry | usage, rate limit, cache, security events silently off since 12 Sep | helpers read Supabase-only env vars | all via `backend.ts serviceRest`; `TELEMETRY PROBLEM:` log; `/ready` telemetry | STAGING_PASS | `_shared/llm.ts`, `rate-limit.ts`, `audit.ts`, `backend.ts`, `functions-service/main.ts` | — | 1 DeepSeek call → llm_usage + rate_limits + llm_cache rows; cache hit | deno suite | n/a | previous functions image | alert policy not created yet |
| AI-T | AI | no timeouts | request held up to 300 s | 90 s per provider attempt, `LLM TIMEOUT:` log | STAGING_PASS | `_shared/llm.ts` | — | functions /ready, live calls | deno suite | n/a | previous image | — |
| N20 | Resume | answer keys + hidden tests readable and writable by student | `FOR ALL` own-row policy | SELECT on safe columns only; no writes | STAGING_PASS | — | 50 | student GET/PATCH/INSERT/DELETE → 403; server still reads | migration self-check | — | 50-rollback | — |
| N21 | Resume | Submit returned hidden tests | full results returned | `redact()` | STAGING_PASS | `resume-code-execute` | — | Submit reply has no hidden stdin/expected | — | — | previous image | — |
| F10 | Code runner | graded code + hidden tests sent to public runners | Wandbox/Godbolt/Glot fallback | own runner only; public only if ENVIRONMENT∈{staging,development} AND opt-in; production never | STAGING_PASS | `_shared/sandbox.ts` | — | functions → runner path works | `sandbox_test.ts` (production+override → no public call) | — | previous image | — |
| F6 | Accounts | sync hard-deleted students from one listing | `remove_students` (cascade) | grace + recheck → **suspend** (reversible); abnormal-drop guard max(25, 5%); suspend ceiling 3/pass → else admin review; restore on return; never delete | STAGING_PASS (RPCs) | `accounts/server.py`, `sync_plan.py` | 51, 55 | suspend → `suspended`, restore → `active`, ledger cleared; protected untouched | `accounts/test_sync_plan.py` (0/1/3/5/50/51/2%/50%/empty/protected/config) | — | 55-rollback | staging accounts robot cannot list logins, so full `/sync` runs only in production |
| FIX-PROT | Test fixtures | test logins deleted by the team / sync | none | `protected_test_accounts`; delete trigger on `auth.users`; sync skips them | STAGING_PASS | — | 55 | `remove_students` on a protected student → refused | migration self-check | — | 55-rollback | — |
| F4 | Accounts | import linked unconfirmed accounts | email match only | `account_email_confirmed()` required | STAGING_PASS | `create-student-users` | 51 | unconfirmed → "unverified, not linked"; confirmed → linked | — | — | previous image | — |
| N25/F7 | Accounts / scheduler | reset link for any email; `!==` compare | link to any webhook-secret holder | link only for logins < 1 h old, never admins; constant-time compares | STAGING_PASS | `accounts/server.py`, `_shared/secret.ts`, scheduled-job, transcription-reap | — | wrong/partial/missing secret → 401 | `secret_test.ts` | — | previous images | OIDC for scheduler (Wave 7) |
| W2 | Frontend | dead files | 24 files with zero importers | deleted | STAGING_PASS | 24 files | — | build, routes 27 = 27 | unit 95 | NOT_STARTED | revert commit | — |
| F8/F9 | Code runner | leftover processes; no memory/egress limits; pipe hang | — | kill uid + tmp cleanup after every run; caps; netns | STAGING_PASS | `code-runner/server.py` | — | 22/22 on staging runner | `code-runner/test_runner.py` (CI) | n/a | previous runner image | OIDC invoke (§12) NOT_STARTED |
| ENGINE | Coding | two coding evaluators; unvalidated resume tests | — | one engine + test-quality gate; resume uses it | STAGING_PASS | `_shared/auto-config.ts`, `test-quality.ts`, resume functions | 52 | resume round: `print(4)` 1/5; correct passes | `test-quality_test.ts` | NOT_STARTED | previous image + 52-rollback | Sponsored coding (§15) NOT_STARTED |
| FREEZE | Coding | evaluators editable after grading | — | frozen once used | IN_PROGRESS | — | 52 | migration self-check on rubric | — | — | 52-rollback | explicit Daily + Resume proof pending (§13) |
| LOT-Q | Lots | bad wording | free text | contract + validator; pre-generation | STAGING_PASS | `_shared/lot-wording.ts`, `lot-pipeline.ts`, scheduled-job | 53 | 3/3 pages written; coding Lot with full sections | `lot-wording_test.ts`, `lot-pipeline_test.ts` | NOT_STARTED | previous image + 53-rollback | idempotency/retry proof (§18) |
| L1/N24 | Company | companies never saw work | read `proof_uploads` | `company_submissions()`, reviews, rebuilt nav | STAGING_PASS (API) | startup screens, hooks | 54 | student submitted → company saw + reviewed | — | NOT_STARTED | 54-rollback | browser E2E |
| CI | CI | — | test job only | + runner job, active Deno check, Python | IN_PROGRESS | `.github/workflows/deploy.yml` | — | run 37094913221 success @ ab62ee7 | — | — | — | build-once (§44) NOT_STARTED |
| §14 | Tasks | tasks can exist without an evaluator | trigger falls back to the generic checklist | evaluator required before publish | NOT_STARTED | | | | | | | |
| §15 | Sponsored coding | sponsored Lots graded by the generic checklist | — | shared engine | NOT_STARTED | | | | | | | |
| §16 | Source privacy | college material may reach other colleges | — | college-scoped unless shared | NOT_STARTED | | | | | | | |
| W5 | Build-log / Admin / TPO / Squads | legacy dependencies | — | current evidence only | NOT_STARTED | | | | | | | |
| W6 | Voice | optional, unlinked | — | required, bound to submission, immutable | NOT_STARTED | | | | | | | |
| W7 | Auth | F1/F2 | shared HS256, service_role everywhere | asymmetric signer; caller JWT | NOT_STARTED | | | | | | | |
| W8 | Legacy | proof/trust remnants | — | removed | NOT_STARTED | | | | | | | |
| W9 | Migrations / IaC | two folders, no ledger | — | one path + ledger | NOT_STARTED | | | | | | | |
| W12 | Scale | unproven | — | 15k staging dataset + progressive load | NOT_STARTED | | | | | | | |
