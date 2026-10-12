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
| 6 | P3 | failure bundle scrubbing regex held backspace characters, so typed text would have reached the bug report (my own S40 code; caught by its test) | shell layer turned `\b` into U+0008 | 9d6d296 | `sidhu_s40_e2e_infra.test.mjs` | FIXED |
| 7 | P4 | drift checker read `create table auth.users` as a public table `auth` | regex accepted a schema prefix as the name | 4c75abb | `sidhu_s41_contract_drift.test.mjs` | FIXED |

Reviewed, not bugs: two inventory "dead buttons" (`StudentAssignedTasksPage` "Under Review" badge; company
"Delete Account", deliberately disabled: companies are deleted by an administrator).

Not fixed, reported:
- Staging has no scheduler jobs except `transcription-reap`: nightly squads, daily Lots, weekly seasons and the
  account sync never run there, so no scheduled workflow can be proven on staging (TEJA / owner).
- `generate_round_robin` exists only live and nothing calls it; `verification_settings` / `manual_adjustment_log`
  wait for migration 94 on staging. Clean-up, not launch-critical.
- A Google account deleted in the Console keeps an open session until token refresh (about 55 minutes): measured
  by `web-bff/identityFaults.test.ts`; 110's sync cuts access after its grace period. Owner decision on the window.
