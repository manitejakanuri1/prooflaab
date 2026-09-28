# Step 6EE — Migration 46 audit report

Date: 2026-09-28. Branch `work/step6j-release-gates`. Status: **PREPARED, NOT APPLIED — ready for independent review.**

## 0. Revision 2 (2026-09-28): rebuilt from the actual production bodies

- The owner's production pre-check returned **false** for both fingerprints. Production had talent `b47030ab…` and profile `642189a0…`; the scripts expected `f7c1eef2…` and `b467d6f7…`. The script would therefore have refused to run, as designed.
- The owner exported the exact production definitions (`pg_get_functiondef`). They are saved in `migration/step6ee-production-before/`.
  - Their fingerprints match production.
  - Compared line by line with the repo's stage69 / stage35c versions: **the executable SQL is identical; only comments differ.**
    - `recruiter_talent`: one comment line is absent in production.
    - `recruiter_proof_profile`: 5 comments are reworded or added.
  - The full diff is in `docs/STEP6EE-DIFFERENCES.md`.
- The execution and rollback scripts are now built from the production text. They keep all existing logic and comments, and add only:
  - the 3 server-only filters;
  - the reviewed permission change: revoke from PUBLIC and anon, grant to authenticated.
- The rollback restores the production bodies **byte for byte** (proven on staging), and keeps the tightened grants.
- **Production grants are still unknown:** the export didn't include them. The script doesn't assume them. It revokes from PUBLIC and anon, grants to authenticated, and leaves every other grantee as it is. Part 3 of the pre-check file lists them one row per grantee. Please run it before approval.

## 1. Files

| File | Use |
|---|---|
| `migration/step6ee-migration-46-production-prereq-readonly.sql` | Run FIRST in production (read-only). Part 1 rows must all be `t`. Part 2 = impact numbers |
| `migration/step6ee-migration-46-production-execution.sql` | The only script to run for 46 (after approval) |
| `migration/step6ee-migration-46-production-verify-readonly.sql` | Run AFTER (read-only). All 11 rows must be `t` |
| `migration/step6ee-migration-46-rollback.sql` | Emergency undo |
| `migration/46-recruiter-provenance-filter.sql` | ORIGINAL. **Never run in production** (header added) |
| `scripts/dev-tools/step6ee_build.py` | Generates the execution, rollback and rehearsal SQL from the migration files |
| `migration/step6ee-staging-rehearsal-2026-09-28.txt` | Full staging output |
| `migration/step6ee-production-before/` | Exported production definitions (starting point and rollback target) |
| `docs/STEP6EE-DIFFERENCES.md` | Exact diffs: production vs repo, and production vs Step 6EE |

## 2. What migration 46 does

A recruiter should only see, and filter on, communication scores from voice explanations with `transcript_source = 'server'`. A student can insert a made-up transcript (`'browser'`) and get it scored, so browser-sourced scores must not reach recruiters.

- Changes two functions: `recruiter_talent` (the `comms_score` column and the `_min_comms` filter) and `recruiter_proof_profile` (the `explanations` list and the `communication` average).
- No table, row or column changes.
- The `trust-compute` part of the same fix is Deno code. It isn't in this migration and isn't deployed.

## 3. Defects found in the original migration 46

| # | Defect | Evidence | Fix |
|---|---|---|---|
| D1 | **It undoes stage69.** 46 was written from stage35c's `recruiter_talent`. stage69 later changed `proofs_verified` to also count passed `task_submissions`. Running 46 as written replaces the whole function, so that count is lost | Staging run R: original 46 applied on the stage69 body, then `task_submissions` counted = **f**. Staging itself is already in this regressed state (its body md5 `a8a046d7…` = the original 46) | The filter is applied to the **exported production** bodies (same logic as stage69 / stage35c) |
| D2 | The permissions it leaves are wrong. Staging has EXECUTE for **PUBLIC and anon** on both functions. stage35c's intent was to revoke from public and anon, and grant to authenticated. Production's state is unknown | Staging ACL `{=X/postgres, …, anon=X/postgres, …}` | The script revokes from PUBLIC and anon, grants to authenticated, and checks this before COMMIT |
| D3 | No pre-checks, and no check that nothing else changed | — | See section 4 |

## 4. Safety design of the execution script

- **One transaction** with `lock_timeout 5s`. Every check runs before COMMIT, so any failure means nothing is kept.
- **Pre-checks:**
  1. Exactly one of each function, with the expected signature and return type.
  2. It refuses if any `transcript_source` filter is already present, whether from the original 46 or this script.
  3. It refuses unless the current bodies match the expected versions exactly. The comparison is an md5 of each body with its whitespace normalised: production talent `b47030ab…`, production profile `642189a0…` (the exported production bodies). So any drift in production stops the script instead of being overwritten.
  4. The current user must own both functions.
  5. `transcript_source` must exist, with a CHECK that allows `'server'`.
  6. `task_submissions` and the recruiter helper functions must exist.
- **Post-checks:**
  1. The new body md5s match exactly: talent `66d86705…`, profile `95a23fd3…`.
  2. stage69's `task_submissions` count is still present.
  3. Return types are unchanged, SECURITY DEFINER is on, search_path is pinned, and the owner is unchanged.
  4. authenticated can run both functions. anon and PUBLIC can't.
  5. **Every other public function is unchanged** (body, ACL and owner, compared with a snapshot), and none was added or removed.
- **Compatibility:**
  - The output columns and JSON keys are identical, so no frontend change is needed (`src/recruiter/*`).
  - `recruiter_home` calls `recruiter_talent` as the owner, and still works.
  - No server function calls either function.
  - `CREATE OR REPLACE` keeps the owner and existing grants. Only the explicit revoke/grant changes the ACL.

## 5. Staging test evidence (run `prooflab-staging-inspect4-qbrmx`, PostgreSQL 17.11)

| Test | Result |
|---|---|
| A. Exact execution script on real staging (staging already has the original 46) | ✅ Stopped at the pre-check: "filter already present". Both functions identical before and after, and identical again at the end of the run (body md5 and ACL) |
| R. Original 46 on the stage69 state | ❌ Regression confirmed: the `task_submissions` count is lost |
| B. In one rolled-back transaction: restore the expected production "before" bodies, run the script, run behaviour tests, then run the rollback script | ✅ Pre-checks passed, post-checks passed, and **7 of 7 behaviour checks** passed (details below). The rollback script restored stage69 / stage35c and passed its own checks |
| N1. "Before" body drifted by one comment | ✅ Stopped at the pre-check (md5 mismatch) |
| N2. Script run twice | ✅ The second run stopped at the pre-check |
| C / D. Pre-check and verify files on staging | Ran without errors. Rows about the body version are `f` **as expected**, because staging has the original, regressed 46. The permission rows show staging's PUBLIC/anon grants |

The 7 behaviour checks used a real staging student with 11 browser-sourced and 23 server-sourced scores. In the test, a verified recruiter was set up and one passed auto-graded submission was added, all rolled back:
- `comms_score` = **41**, the server-only average. With browser scores it would have been 48.
- `proofs_verified` = **1** = verified proofs (0) + passed submissions (1). So stage69 is kept.
- The `_min_comms` filter uses the server score only.
- The profile's `communication` = 41, and its `explanations` list contains server rows only.
- A signed-in non-recruiter gets no candidates, and gets an error when asking for a profile.

## 6. What could not be established (blockers for approval)

1. **The production database state was not inspected.** Claude has no production database access. That's by design: no authorised networks, and the `prooflab-db-uri` secret must not be read. Creating a temporary database login would be an IAM change, which isn't allowed here. **Action:** the owner runs `step6ee-migration-46-production-prereq-readonly.sql` in Cloud SQL Studio, and every Part 1 row must be `t`. If rows 1–2 are `f`, production has different function bodies. Stop, and send the shown md5 values back for review.
2. **Product impact decision.** After 46, recruiters see communication scores **only** from server-transcribed recordings. In production the async server pipeline isn't live yet, so most or all scores are likely `'browser'`. Recruiters would then see an **empty** communication score for those students, and any `_min_comms` filter would exclude them. Part 2 of the pre-check file gives the exact numbers. The owner must accept this, or wait until the server pipeline is live.
3. **It wasn't run as `prooflab_app`.** Staging objects are owned by `postgres`. The pre-check stops the script if the user running it doesn't own both functions.
4. **Staging is out of step:** its `recruiter_talent` has already lost stage69's count, and it has PUBLIC/anon grants. Fixing staging needs its own approval.

## 7. Rollback instructions

1. Only with the owner's approval.
2. Run `migration/step6ee-migration-46-rollback.sql` in Cloud SQL Studio as the function owner. It refuses unless the exact Step 6EE bodies are present. It restores stage69 `recruiter_talent` and stage35c `recruiter_proof_profile`, checks the result, and commits.
3. Grants stay "authenticated only". Re-opening them to anon or PUBLIC isn't an improvement.
4. No data needs restoring: migration 46 changes no rows.
5. Afterwards, check that `step6ee-migration-46-production-prereq-readonly.sql` rows 1–2 show `t` again.

## 8. Rules followed

- Nothing was run on production.
- Migrations 41–45 and 47 weren't rerun.
- No deploy, IAM or secret change.
- `main` and Step 7 weren't touched.
- All staging changes happened inside transactions that were rolled back. The only committed staging action was the read-only inspection.
