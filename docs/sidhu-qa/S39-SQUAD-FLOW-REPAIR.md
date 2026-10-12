# S39: squad vacancy filling and the college Branch dropdown (12 Oct 2026)

Branch: `fix/sidhu-s39-squad-auto-fill-2026-10-12` (own worktree `prooflaab-sidhu-claude-s39`), based on TEJA `7704a98`.
Untouched: TEJA's S36 branch, Sidhu's S38 branch (`74c3a12`, not merged in), every older worktree (five have uncommitted
files: s26, s28, s29, s30, qa-2026-10-08; none was opened for writing).
Not done: no deploy, no migration applied, no traffic, bucket, IAM or DNS change, no student moved or deleted.
Live checks were read-only: one `begin transaction read only … rollback` query on **staging** (counts only), Cloud
Scheduler listing, and the production `nightly-squads` job log lines.

## Answer first

| Question | Answer |
|---|---|
| Was any screen or control changed? | **No.** No file under `src/` differs from `7704a98`. CI refuses any change there. |
| Did a branch dropdown become a text box in the code? | **No.** Every branch control is a dropdown in `7704a98` and in `main`; history shows no dropdown replaced by a text box. |
| Then what did the owner see? | Most likely **College → Import students → Branch** on **staging**. That dropdown lists the default naming themes, then "Other…". Staging has **0** default themes, so the only choice is "Other…", which opens a box to type the branch. A data gap, not a code change. **Needs a screenshot to confirm** (see below). |
| Do squads below eleven fill from the reserve? | The code already tries, every night (05:35 IST), after every import and on Generate. **It silently fails for a whole college as soon as one squad with a free seat is locked**, and it overfills squads the college set below eleven. Fixed in migration 108. |
| Is 108 live? | No. Nothing is applied anywhere. |

## Phase 1: the Branch dropdown

### What was checked

| Screen | Control at `7704a98` | Same in `main` (live site)? | Changed recently? |
|---|---|---|---|
| College → Import students | Dropdown: default themes + "Other…" (typed box only after "Other…") | yes | no (since 25 Aug 2026, stage 41) |
| College → Students | Branch filter dropdown, "All branches" | yes | no |
| College → Squads | Assign / Manage tabs, Create squad, Generate, Rebalance | yes | no |
| Assign Tasks (college and admin) | "Select branch" dropdown ×2, "All branches" filter ×2 | yes | no |
| College onboarding | "Branches Offered *" checkboxes | yes | no |
| College → Profile | "Branches Offered" **comma box** | yes | no (since 6 Sep 2025) |
| Admin → Student Oversight → add student | Branch **text box** | yes | no |

The only recent removal of a branch dropdown is `StudentsManagement.tsx`, deleted on 3 Oct (b834d28) as an unused file:
nothing routed to it.

### Old / current / required

| | Import students → Branch |
|---|---|
| Old (designed, stage 41) | Dropdown: CSE, IT, ECE, EEE, MECH, CIVIL, AIML, DS, then "Other…" |
| Current, production | The same: production has the 9 default themes (data model, 3 Oct 2026) |
| Current, staging | Dropdown holding only "Other…" → selecting it shows a text box. Staging has **0** default themes (read-only, 12 Oct) |
| Required, unchanged | The dropdown as designed. **Fix = data, not UI:** migration 109 inserts the missing defaults (no-op in production) |

**Evidence gap:** I could not see the owner's screen. If the screenshot shows College → Profile ("Branches Offered",
comma box), that box has been a text box since September 2025 and differs from onboarding's checkboxes by design;
changing it would be a UI change and needs the owner's approval first.

## Phase 2: squads

### Root cause

`form_squads` (migration 59) seats unplaced students in the existing squads of their own section, emptiest first,
up to eleven, before it draws new squads. It runs nightly (`prooflab-nightly-squads`, enabled; production log: ok,
0 placed, every night for 8 days), after every import, and on Generate. Its choice of squad did not exclude:

1. **Locked squads.** The membership guard refuses a locked squad, so the whole run for that college failed: nobody
   in any section of that college was placed, every night (proven: test "ROOT CAUSE (before 108)").
2. **The squad's own seat limit.** A squad the college set to nine was filled to eleven.
3. And `form_all_colleges` turned the failure into a NOTICE nobody sees, and still answered ok, 0 placed.
4. Two runs at once (nightly job, import, button) collided on the same student: the second failed (proven on a real
   server: "BEFORE 108: … fails when the first commits").

Staging today: 1,320 squads, all exactly 11, none locked, 490 students in reserve (126 sections). So there is nothing
to fill on staging now; vacancies appear after removals. Production could not be read (no read-only path was used).

### Before / after

| | Before 108 | After 108 |
|---|---|---|
| Locked squad with a free seat | whole college's run fails, nightly, silently | that squad is skipped; the rest of the college is filled |
| Squad set to N < 11 seats | filled to 11 | filled to N |
| Seat twelve | free | free (Assign still uses it; 13th refused) |
| Two runs at once | the second fails | one at a time per college; the second places nobody |
| Student assigned by the college during a run | the run fails | the college's choice stands; the run skips them |
| A college fails in the nightly job | `ok`, 0 placed, NOTICE | `status: partial_failure`, `colleges_failed`, `first_error`; log line `JOB SANITY: nightly-squads …` |
| Old season, archived squad, other section / branch / college, blocked student | not used | not used (now tested) |
| Fewer than 11 left, no squad | wait for the college | **unchanged**: wait for the college |
| Assign, Rebalance, Create squad, scoring, matches, history | — | unchanged (tested) |

## Files

| File | Change |
|---|---|
| `migration/108-squad-vacancies-fill-safely.sql` (+ mirror `20261103005800`) | 3 anchored edits to live `form_squads` (lock, squad choice, skip a seat taken meanwhile), each refused unless found once; `form_all_colleges` reports failures; self-check of owner, ACL, grants |
| `migration/108-rollback-…` | both functions verbatim from migration 59 / stage 33 |
| `migration/109-default-squad-name-themes.sql` (+ mirror `20261103005900`) | adds missing default themes only; never touches a college's own |
| `migration/109-rollback-…` | note: nothing removed, on purpose |
| `supabase/functions/scheduled-job/index.ts` | one `JOB SANITY` line when `colleges_failed > 0` (silent before 108 is applied) |
| `scripts/dev-tools/sidhu_s39_squad_fixture.mjs` | schema slice; functions cut from their real migrations |
| `scripts/dev-tools/sidhu_s39_squads.test.mjs` | 30 PGlite tests |
| `scripts/dev-tools/sidhu_s39_squads_concurrency.test.mjs` | 4 tests, real PostgreSQL 16, several sessions |
| `scripts/dev-tools/sidhu_s39_ui_contract.test.mjs` | 6 freeze tests of the college controls |
| `.github/workflows/s39-squad-regression.yml` | all of the above in CI, plus `git diff` freeze of `src/` and a psql apply/rollback/re-apply |
| **UI files** | **none** |

## Tests

Sizes 0, 1, 7, 10, 11, 12 (and 0 with 3, 1 with 20); empty and partial squads; reserve and no eligible reserve;
other college, branch, section and season; locked and archived; blocked; duplicate prevention; idempotent re-run
(no second membership, no second notice); seat taken mid-run; history, points, results and audit kept; removal then
import; reconcile of vacancies left before 108; fewer than eleven with no squad; Assign twelfth seat and thirteenth
refused; Rebalance unchanged; privileges; 108 refuses a different `form_squads`; idempotent; rollback restores both
functions exactly, then re-apply; 109 empty, twice, overrides kept, browser cannot write, naming unchanged.

Mutation run (each 108 change removed on its own): locked skip, seat limit, unique-violation skip, failure counting,
status, lock: all caught (the lock by 108's own self-check here, by behaviour in the concurrency suite). Not caught,
accepted: the explicit `s.college_id = _college_id` (the season already belongs to one college).

## Staging integration blockers

1. Owner approval to apply 108 then 109 on staging (`gcloud sql import sql`, through the ledger wrapper).
2. Before applying: confirm the live `form_squads` is the migration 59 version (108 refuses otherwise; no harm).
3. Staging E2E: lock a squad with a free seat, remove one student from another squad, import one student, run the
   nightly job, and prove by database rows that both vacancies are handled and the job reports no failure.
4. Owner screenshot of the Branch complaint (see the evidence gap above).

**Rollback plan:** `108-rollback` restores `form_squads` and `form_all_colleges` exactly; memberships created meanwhile
stay (they are valid). 109 is not rolled back (its rollback note says why). The `scheduled-job` line is inert without 108.

## Owner decisions

1. **Policy change:** `SQUAD_SYSTEM.md` says leftovers wait for the college. The nightly job already seated reserves
   into existing squads below eleven since migration 59; 108 keeps that and makes it work. Confirm that is wanted.
2. Should a removal fill its vacancy at once, or is "by 05:35 IST the next morning (or the next import)" enough?
   108 does not change removal.
3. Fewer than eleven students and no squad: today they wait (college can Create squad). Options: keep, or draw a
   short squad automatically. Not changed.
4. Squad points are the sum of members' points, so a squad of 7 scores against squads of 11. Not changed.
5. Rebalance fills to the squad's limit (twelve) and looks at every non-archived squad of the college, not only this
   season's. Kept exactly as it is; flagged only.
