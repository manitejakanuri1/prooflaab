# Bugs fixed and their regression tests (S40 + S41, 13 Oct 2026)

Branch `fix/sidhu-s40-e2e-and-identity-faults-2026-10-13`. Every fix has a test that fails without it (shown by
removing the fix and rerunning). "Shared" = another owner's file; TEJA reviews and integrates.

| # | Severity | Bug (found how) | Root cause | Fix (commit) | Regression test | Status |
|---|---|---|---|---|---|---|
| 1 | P2 | `POST /sync?dry_run=1` answered 404: the safe preview of the account sync never ran (S40 fault injection over real HTTP) | router compared `self.path` (includes the query) with `"/sync"`; still present in TEJA 441d378, whose tests call `Handler.sync()` directly | `accounts/server.py` route (8c57c06, re-applied on 441d378 in d4840a8). Shared | `accounts/test_sync_faults.py` dry run over HTTP | FIXED OFFLINE; live BLOCKED (staging accounts not redeployed) |
| 2 | P2 | a failed write of newly missing logins was answered 200 (S40) | status of the ledger write ignored | 8c57c06; superseded by TEJA 110's single checked apply | same file, 110 design | FIXED (by 110) |
| 3 | **P1** | accounts with no Google mapping could be cut off by the sync; on staging (15,004 such seeded students) every pass aborted (S40) | `identity_sync_accounts` uses the app id as login id when no mapping exists; the plan treated "not listed" as missing | `accounts/sync_plan.py`: unmapped and not listed = never marked or cut, not counted by the guard, reported as `unmapped_absent` (d4840a8). Shared | `accounts/test_sync_unmapped.py` (6) + HTTP end to end | FIXED OFFLINE |
| 4 | **P1** | `complete_own_wizard` and `touch_my_activity`, called by the website, existed in no migration: a database rebuilt from migrations could not finish a student's onboarding or mark activity (S41 contract drift, every file under `src/`) | created by hand in the live databases, never written down | migration 111 (a20bb45): staging definitions and grants unchanged. Shared (DB) | `sidhu_s41_contract_drift.test.mjs` (fails without 111), `sidhu_s41_live_only_functions.test.mjs` | FIXED in source; apply BLOCKED (TEJA) |
| 5 | **P1** | triggers `task_assignments_activity` / `voice_explanations_activity` (student activity log: Lot completed, voice recorded) existed only live (S41 schema diff staging vs migrations) | same | added to 111 (4c75abb) | PGlite: logged once per completion, not on other updates, re-apply does not double | FIXED in source; apply BLOCKED |
| 5b | **P1 (data integrity)** | College -> Students "N squads are now empty. Remove them?" -> OK deleted squads that had played: their matches (and each opponent's match record), weekly scores, membership history, and a finished season's champion / runner-up / third (S41: untested-write-endpoint scan, then PostgreSQL with the deployed function) | `tpo_delete_empty_squads` (migration 25) treats "no CURRENT member" as empty; matches / scores / members are ON DELETE CASCADE, podium SET NULL | migration 112: only never-used squads (no membership row ever, no match, no score, no podium place) are removed; the prompt counts the same set. Same names, grants, screen. Shared (DB) | `sidhu_s41_squad_management.test.mjs` (5: bug reproduced on the deployed body, fix keeps history, past member keeps squad, college isolation, create squad) | FIXED in source; apply BLOCKED (TEJA) |
| 5d | P4 | College -> Squads -> Manage: an empty squad could be saved with **0 seats** (nobody can ever join), and a squad could be **renamed to another squad's name** in the same season (S41, deployed body on PostgreSQL) | `tpo_squad_update` (stage 24) checks only "not below current members"; the seat box is read on click so the browser's `min=1` never runs; create enforces unique names, update did not | migration 113: at least one seat, unique active name per season; stage 24's body otherwise verbatim, same grants. Shared (DB) | `sidhu_s41_squad_settings.test.mjs` (5: cohorts from the file, settings, both gaps reproduced, fixed, resets) | FIXED in source; apply BLOCKED (TEJA) |
| 5c | P3 | `assign_tasks` answered **500** "An unexpected error occurred" to a garbage, forged or expired ticket (S41: all 22 untested write functions driven through the real handlers) | thrown 'Invalid authentication' vs a case-sensitive match on 'Authentication' | case-insensitive match (f94a5ed). Shared | `functions-service/write_authz_test.ts` (118: every bad ticket 401, students 403 on staff functions, nothing written, no AI call) | FIXED; in the release gate |
| 6 | P3 | failure bundle scrubbing regex held backspace characters, so typed text would have reached the bug report (my own S40 code; caught by its test) | shell layer turned `\b` into U+0008 | 9d6d296 | `sidhu_s40_e2e_infra.test.mjs` | FIXED |
| 7 | P4 | drift checker read `create table auth.users` as a public table `auth` | regex accepted a schema prefix as the name | 4c75abb | `sidhu_s41_contract_drift.test.mjs` | FIXED |

Reviewed, not bugs: two inventory "dead buttons" (`StudentAssignedTasksPage` "Under Review" badge; company
"Delete Account", deliberately disabled: companies are deleted by an administrator).

Not fixed, reported:
- Staging has no scheduler jobs except `transcription-reap`: nightly squads, daily Lots, weekly seasons and the
  account sync never run there, so no scheduled workflow can be proven on staging (TEJA / owner).
- CORRECTION (S41): `generate_round_robin` was reported "live-only, nothing calls it". Wrong: stage 37 creates its
  three-argument form and drops only the old two-argument overload, and `extend_fixtures` (nightly `extend-fixtures`)
  calls it. The drift check now tracks signatures, renames and types; staging has 0 live-only functions after 111.
- `verification_settings` / `manual_adjustment_log` wait for migration 94 on staging. Clean-up, not launch-critical.
- Function bodies: every existing function references only existing objects, except two reviewed ones
  (`remove_students` is rewritten in place by 106; `thread_post_count` belongs to the removed feed). Regression test.
- A Google account deleted in the Console keeps an open session until token refresh (about 55 minutes): measured
  by `web-bff/identityFaults.test.ts`; 110's sync cuts access after its grace period. Owner decision on the window.
