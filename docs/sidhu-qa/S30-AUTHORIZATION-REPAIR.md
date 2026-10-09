# S30 — Authorization and proof-integrity repair (9 Oct 2026)

Worktree `prooflaab-sidhu-claude-s30`, branch `fix/sidhu-s30-authz-proof-integrity-2026-10-09`, base `851cf7ecca4ff92be2e1507cca9476a33c057728`.
Local source and migration changes only. **No commit, push, merge, deploy, applied migration, database write, cloud, IAM or Identity change.** S29 is unchanged.

## Answer first

| Finding | Severity | Status | Proven how |
|---|---|---|---|
| S29-05 self-made task → verified proof | High | **FIXED IN SOURCE** (not deployed) | Real-Postgres offline harness: the full chain reaches a `passed` submission BEFORE; every link refused AFTER |
| S29-03 rewriting titles / sponsor / origin of own tasks | High | **FIXED IN SOURCE** | Same harness: 6 tampering attempts succeed BEFORE, change nothing AFTER |
| S29-01 college manual Assign Task / Save as Template / audit log | High (functional) | **FIXED IN SOURCE** | Refused BEFORE, works AFTER for own students only; 6 cross-tenant and forgery cases refused |
| S29-06 anonymous `public_resume_scorecards` | Medium | **FIXED IN SOURCE** | anon reads a row BEFORE, permission denied AFTER; signed-in still reads |
| S29-02 student-made "completed" tasks inflate "Lots done" | Medium | **FIXED IN SOURCE** (new rows); historical rows NOT VERIFIED | Insert stored BEFORE, impossible AFTER |
| S29-04 job posts bypass approval | Medium | **FIXED IN SOURCE**; whether colleges should auto-publish is an **owner decision** | Company / pending college forced to `pending`; admin and verified college unchanged |
| S29-08 role self-claim without migration 100 | Medium | **FIXED IN SOURCE** (103 drops it again; idempotent) | New account's self-claim refused on a "100 never ran" database with 103 applied |
| S29-07 / 09 / 10 | Low | **NOT CHANGED** (documented, out of S30 scope) | Asserted still open so a change is noticed |

**Release recommendation: production NO-GO for these fixes until they are integrated, applied to staging and verified there. GO for a staging rehearsal now.** Section 7 gives the order.

Nothing here is verified on a live database. "Offline" below means two simulations:
- **Real-Postgres simulation (strongest):** PGlite, i.e. PostgreSQL 16.4 compiled to WebAssembly. It runs in memory inside the test process and is thrown away. It loads the repository's own SQL for the affected tables, then `migration/103` exactly as written, and runs every scenario under `SET ROLE` with signed claims, as PostgREST does.
- **Policy-model evaluation:** S29's evaluator, extended, across all 21 browser-written tables.

## 1. What changed (exact files)

| File | Change |
|---|---|
| `migration/103-task-provenance-and-authz-repair.sql` | **New** migration (one transaction, `do $$` self-check, `notify pgrst`) |
| `supabase/migrations/20261103005300_task_provenance_and_authz_repair.sql` | Identical copy (project rule) |
| `migration/103-rollback-task-provenance-and-authz-repair.sql` | **New** rollback; pre-103 bodies generated verbatim from the repository |
| `supabase/functions/_shared/submission.ts` | `selfAuthoredTask()` helper |
| `supabase/functions/_shared/submission_test.ts` | Deno test for the helper |
| `supabase/functions/submit-written-task/index.ts` | Reads `inserted_by`; refuses a self-authored task (403) |
| `supabase/functions/submit-sandbox-task/index.ts` | Same |
| `scripts/dev-tools/sidhu_s30_policy_model.mjs` | Copy of the S29 model (unchanged logic) |
| `scripts/dev-tools/sidhu_s30_permission_eval.mjs` | S29 evaluator plus the atoms migration 103 uses |
| `scripts/dev-tools/sidhu_s30_permission.test.mjs` | S29 suite plus post-repair expectations |
| `scripts/dev-tools/sidhu_s30_pg_harness.mjs` / `.test.mjs` | **New** real-Postgres before/after harness and its 16 tests |

No React file changed. The existing college screens (`AssignTasksScreen`, Save as Template) work unchanged once 103 is applied.

## 2. The repair, by finding

### S29-05 and S29-03 — task provenance and integrity (P0)

The trust chain, and where it is now cut:

| Link | Before | After (migration 103 + functions) |
|---|---|---|
| 1. Student inserts a task | `tasks_own_insert` allowed `student_id = auth.uid()` | Policy **dropped**. Only `tasks_admin_insert` and `tasks_college_insert` remain. The insert clamp also refuses `student_id = auth.uid()` (second layer). |
| 2. Student PATCHes `grading_type`, so `task_default_checker` attaches the generic rubric after `protect_tasks` froze it | `tasks_own_update` allowed it; trigger order `protect_tasks` → `task_default_checker` | Policy **dropped**; only admins update. `tasks_zz_guard_integrity`, named to fire **last**, refuses any non-admin browser UPDATE that changes any column, including one changed by an earlier trigger. The self-check asserts it is last. |
| 3. Function grades it | `submit-*-task` accepted any task whose `student_id` is the caller | Both functions refuse `selfAuthoredTask(task)` with 403 |
| 4. Database records `passed` | `record_task_submission` checked nothing about the task | Refuses a self-authored task, a submitter who neither owns nor was assigned the task, and a checker that is not the task's own |
| Provenance source | none trustworthy (`created_by_type` is null on real paths and forgeable) | **`tasks.inserted_by`**: set by trigger on **every** insert (the caller's id for a direct API insert, null for server / definer paths). It cannot be chosen; the harness shows even a superuser's chosen value is overwritten. |
| Sponsor / origin / visibility / title | writable by the student on own rows | No student UPDATE at all. College inserts are clamped (`sponsored_by`, `created_by_startup_id/admin_id`, Lot fields, `level_id`, `source`, `visibility = private`, `status = pending`, XP 0, generic written checker). |

Company-facing records now derive sponsorship from trusted writers only. `sponsored_by` / `created_by_startup_id` can be set only by `company_create_lot` (definer), admins, or service paths, so `company_submissions`' `t.sponsored_by = me` check is no longer client-steerable.

Preserved:
- daily Lots (`create_lot_for`), company Lots, roadmap tasks, `start_task_assignment` and `record_task_submission`. All are `SECURITY DEFINER` or service role, which RLS and the `current_user = 'authenticated'` checks do not touch.
- admin edits.
- students reading their own and assigned tasks.

Shown working in the harness.

### S29-01 — college assignment (P0)

| Path | Before | After |
|---|---|---|
| Manual Assign Task (`AssignTasksScreen.tsx:855`) | refused by RLS | `tasks_college_insert`: `created_by_type = 'college'`, `created_by_college_id = my_college_id()` (approved colleges only), and the student's `college_id` must be that college |
| Save as Template (`:303`) | refused (admin only) | `task_templates_college_insert`; `created_by` forced to the caller. Reads are scoped: a college sees admin templates and its own, not other colleges'. |
| Audit log (`:882`) | refused (no INSERT policy) | `audit_logs_college_insert` for the college's **own** tasks only; `user_id` and `college_id` set by trigger, not the caller. Admin insert policy added (the admin path had none either). |

Behavior notes for the owner:
- College-assigned tasks get **XP 0**. That is the existing insert clamp's rule, kept.
- They are always **private** (the screen's "public" choice is ignored).
- They use the generic written checker.

### P1

- **S29-06:** `revoke all on public_resume_scorecards, llm_usage_by_student from anon` (undoing `migration/01`'s re-grant; restores stage48 / stage14 intent).
- **S29-02:** students can no longer insert tasks at all, and the clamp forces `status = 'pending'` for any non-admin browser insert.
- **S29-04:** `job_opportunities_keep_moderation`. Non-admins who are not a **verified** college get `pending` on insert and cannot move a post to anything but `pending`. A verified college keeps auto-publishing, as `PostJobDescription.tsx:57` does today. **Owner decision:** should college posts really skip review? They are visible to every signed-in user.
- **S29-08:** `drop policy if exists user_roles_self_claim`. The self-check fails if any non-admin INSERT policy on `user_roles` remains.

### Not changed (low, documented)

- S29-07: student `cohort` is self-editable.
- S29-09: `student_profiles.user_id` can be re-pointed.
- S29-10: a college owner can change its own `colleges.status`.

## 3. Tests

| Suite | Result |
|---|---|
| `sidhu_s30_pg_harness.test.mjs` (real PostgreSQL 16.4, offline) | **16 / 16 pass**, 0 skipped |
| Mutation check: 15 copies of 103, each with one protection removed | **14 / 15 caught**. The uncaught one is the clamp's self-insert refusal: it is unreachable while the RLS layer holds, and a regression of that layer is caught by the pinned-policy test. |
| `sidhu_s30_permission.test.mjs` (policy model, all 21 tables + `user_roles`) | **14 / 14 pass** (anonymous × 21 tables × 4 operations, cross-student, cross-college, cross-company, escalation, positive controls, repaired findings) |
| Deno, CI set (`_shared/`, `transcription-reap/`, `--allow-read`) | **179 passed, 0 failed** (includes the new helper test) |
| Deno `web-bff/` | 86 / 86 |
| `deno check` (CI set) | pass |
| `python scripts/migrations.py check` | 105 migrations, 0 problems (103 has a mirror, a rollback and a self-check) |
| `test_atomic_migration_guard.py`, `test_release_guard.py` | OK |
| `secret_scan.py` / `legacy_guard.py` | 0 findings / 0 active occurrences |
| `src/lib` unit tests / `npm run typecheck` | 131 / 131 / pass |
| `git diff --check` | clean |
| S29 suite (unchanged S29 worktree) | 16 / 16 |

`repo-checks.log` first records a Deno run without `--allow-read`; that was my command, not CI's, and the base fails the same way. The CI-identical run is the 179/0 line.

Harness scope: a minimal fixture (only the columns these rules touch) plus the repository's own policies, triggers and function bodies for `tasks, task_assignments, task_templates, audit_logs, job_opportunities, user_roles, student_profiles, colleges, task_rubric_config`. Triggers on those tables whose functions are unrelated to these rules were not loaded and are listed in the run (`student_profiles`, `colleges`, `user_roles` session/cohort triggers; `freeze_used_evaluator`). The restored production dump is not in the repository.

## 4. Migration and rollback plan

1. **Prerequisite:** 100–102 applied, in ledger order. 103 requires 100.
2. Apply 103 on **staging** through the ledger (`python scripts/migrations.py wrap migration/103-…sql` + `gcloud sql import sql`, per the handoff).
3. The self-check fails closed if:
   - an unexpected write policy on `tasks` exists (e.g. one only the dump has);
   - the guard trigger is not last;
   - anon can read the views;
   - `record_task_submission` is exposed;
   - a non-admin INSERT policy on `user_roles` exists.
   It **warns** if no generic fallback rubric exists.
4. **Then** deploy `prooflab-functions` (the two submit functions read `tasks.inserted_by`). **Order matters:** functions deployed before 103 would fail every submission with an unknown-column error.
5. **Rollback:** `migration/103-rollback-…sql` (verified in the harness: loads cleanly, passes its self-check, restores the before behavior).
   - It **re-opens S29-01..05**, so use it only if 103 breaks production.
   - It keeps `inserted_by`, keeps anon revoked on the two views, and does not recreate the self-claim.
   - Rolling back the functions is optional; with `inserted_by` kept, they keep working.

No existing row is changed or deleted. `inserted_by` is null on all existing rows.

## 5. Remaining live-database checks (owner-run, read-only)

1. After applying 103 on staging: `select policyname, cmd, roles, qual, with_check from pg_policies where tablename in ('tasks','task_templates','audit_logs','job_opportunities','user_roles');` and `select tgname from pg_trigger where tgrelid = 'public.tasks'::regclass and not tgisinternal order by tgname;`. Compare with section 2.
2. `select public.generic_fallback_rubric_id();` must not be null.
3. **Historical self-made proof (S29-05 before the fix; NOT VERIFIED).** List passed work on tasks no trusted path created. Review it; do not auto-delete:
   ```sql
   select t.id, t.student_id, t.title, t.created_by_type, t.source, t.created_at, s.created_at as passed_at
     from public.tasks t
     join public.task_submissions s on s.task_id = t.id and s.status = 'passed'
    where t.rubric_config_id = public.generic_fallback_rubric_id()
      and t.lot_date is null and t.sponsored_by is null and t.created_by_college_id is null
      and t.created_by_admin_id is null and t.roadmap_scorecard_id is null and t.level_id is null
      and coalesce(t.source, '') not in ('daily_lot', 'sponsored')
      and not exists (select 1 from public.task_assignments a where a.task_id = t.id);
   ```
4. Historical `status = 'completed'` tasks without a passed submission (S29-02 inflation): `select count(*) from public.tasks t where t.status in ('completed','Completed') and not exists (select 1 from public.task_submissions s where s.task_id = t.id and s.status = 'passed');`
5. Signed-in staging journeys (S26 runner) once TEJA's fixture logins exist: college manual Assign Task, Save as Template, a student submitting that task, company Lots.

## 6. Coordination with TEJA

- **Public portfolio (TEJA S27):** 103 revokes anon on `public_resume_scorecards` (read by `usePublicScorecard`). S27's anonymous-portfolio fix must not depend on anon reading that view. Stage48 already decided "scorecards need a login".
- **Migration number:** 103 / `20261103005300`. If TEJA's branches also add a 103, renumber one before merge (the ledger refuses duplicates).
- **Deploy order:** migration before functions (section 4).
- **BFF:** no BFF change is needed. The BFF proxies all `/api/db` methods with the user's token, so RLS is the only gate. That is why these fixes live in the database.

## 7. Release recommendation

- **Production: NO-GO for these fixes until verified.** "Fixed in source" is not "fixed in production": 103 is not merged, applied or verified anywhere.
- **Fastest safe path for 10 Oct:**
  1. Owner / TEJA review this diff.
  2. Merge.
  3. Apply 103 to staging; the self-check must pass.
  4. Deploy functions to staging.
  5. Run section 5 checks 1–2, plus the college Assign Task and student submission journeys.
  6. Only then promote to production, in the same order.
- If that cannot be done before launch, the S29-05 / 03 / 01 risks remain open in production, and the S29 report's severity stands.

## 8. Live staging preflight and a critical correction (9 Oct 2026, later the same day)

### Read-only staging checks (PASS)

Run through `scripts/dev-tools/staging_sql.sh` (staging only), inside `begin transaction read only … rollback`. The SQL files are in `evidence/s30live/`.

| Check | Result |
|---|---|
| Ledger 95, 96, 97, 98, 100, 101, 102 | present; **every checksum equals the repository** |
| Ledger 93, 94 | **absent on staging** (94's tables still exist). Neither touches what 103 changes (checked). |
| Migration 99 | does not exist in the repository (numbering gap, not missing work) |
| 103 applied? | **No.** `tasks_own_insert/update` present; no `tasks.inserted_by` |
| `user_roles_self_claim` | absent (100 applied) |
| Triggers on `tasks` | the 4 expected; none would sort after `tasks_zz_guard_integrity` |
| Generic fallback rubric | 1 |
| `record_task_submission` EXECUTE | authenticated=false, anon=false, service_role=true |
| **S29-06 on staging** | **anon holds SELECT on `public_resume_scorecards` and `llm_usage_by_student` (confirmed live; no data read)** |
| Historical S29-05 / S29-02 rows | **0** self-made-looking passed tasks; **0** completed tasks without a pass (aggregate counts only) |
| Live `tasks_clamp_student_insert` | equal to the repository body |
| Live `record_task_submission` | md5 `f0930e15b377a178042ef468d3524fea`: **contains migration 91's every-test rule; not 93's** |

### Critical correction to migration 103 (found by the live check)

The first version of 103 **re-created** `record_task_submission` from the stage70c file. Migrations 91 and 93 patch that function **in place inside DO blocks**, which the S29/S30 model cannot see. **Applying the first version would have silently undone migration 91** on staging (a coding submission with 4 of 5 tests would be recorded as passed again), and on production also 93. The first rollback had the same flaw. **Nothing was applied, so nothing regressed.**

What changed:
- **103 section 6** now **patches the live function in place**, using the method 91 itself uses: two anchored replacements, each refused unless found exactly once. The self-check verifies:
  - owner, SECURITY DEFINER, config, volatility, return type and grants are unchanged;
  - 91's rule (and 93's, when present) survives;
  - 103's checks are present.
- **The rollback** removes only 103's inserted lines, keeping 91/93.
- **The harness** now loads the function, applies migration 91 verbatim (optionally 93), and normalizes CRLF to LF.
  - **Proven byte-identical to live staging:** stage70c gives md5 `db592468…`, the pre-91 value recorded in migration 91's header; plus 91 gives `f0930e15…`, the live staging md5.
  - New tests: the md5 equality, and that after 103 a 4-of-5 coding submission is still `failed` while 5 of 5 passes.

Results after the correction:
- Real-Postgres suite: **18/18** (staging patch set 91); **17/17 + 1 skipped** (91+93; the skip is the md5 test, staging-specific).
- Section 6 mutation check: 3/3 caught.
- Policy-model suite 14/14; Deno helper 2/2.
- Ledger check 0 problems, mirror identical, atomic guard OK, secret scan 0, legacy guard 0, `git diff --check` clean.

**Anyone integrating "R18": check that R18's 103 does not CREATE OR REPLACE `record_task_submission`.** If it does, it reverts migration 91.

### Steps 3–6: BLOCKED (nothing applied, deployed or signed in)

| Step | Status | Needed |
|---|---|---|
| Source of truth "R18-integrated security patch" | **BLOCKED** | Not found in any local branch, worktree, commit or the `prooflaab` remote. Its location is needed; it must be diffed against this corrected 103 before anything is applied. |
| Staging backup | **BLOCKED (needs authorization)** | `gcloud sql backups create --instance=prooflab-staging-db --project=prooflab-508214 --description="pre-103 S30"` |
| Apply 103 to staging | **BLOCKED (needs explicit authorization)** | `bash scripts/dev-tools/staging_migrate.sh migration/103-task-provenance-and-authz-repair.sql` (through the ledger), then re-run `readonly_preflight.sql` |
| RLS / provenance / cross-student checks with authorized identities | **BLOCKED** | No approved staging test logins (0/5). Owner decision whether the protected staging fixtures may be exercised with `st.py`-minted staging tokens. |
| Deploy `submit-written-task` / `submit-sandbox-task` to staging | **BLOCKED** | Only after 103 passes on staging; deploy path owned with TEJA / Bash |
| Real submission and college assignment checks | **BLOCKED** | Depends on the two rows above |

**Live security status: NOT VERIFIED. No live PASS is claimed.**
