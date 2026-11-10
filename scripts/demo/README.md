# QA Demo scripts (copies for reading)

Copied 11 Nov 2026 from `C:\Users\manit\prooflab-sec-gate\scripts\dev-tools\real_demo\` (commit 8c99e5c)
and the session scratchpad (`demo_visible.*`) so the team can read them in GitHub.
**Run them from the old paths**, which are unchanged and keep working:

| Copy here | Run from (unchanged) |
|---|---|
| `real_setup.py` | `scripts/dev-tools/real_demo/real_setup.py` |
| `real_next_week.sh` + `sql/next_week.sql` + `sql/standings.sql` | `scripts/dev-tools/real_demo/real_next_week.sh` |
| `demo_visible.sh` + `sql/demo_visible.sql` | the scratchpad copy (it sources the old `lib.sh`) |
| `lib.sh` | `scripts/dev-tools/real_demo/lib.sh` |

`precheck_scope.sh` / `sql/precheck_scope.sql` are new: a read-only check that the QA Demo college holds
exactly the 12 demo students and no real student, to run before `real_next_week.sh`.

Scope of every write (the WHERE clauses):
- the college: `colleges.email = 'college@qa-demo.prooflab.invalid' and name = 'ProofLab QA Demo'` (`select ... into strict`: exactly one row or it stops)
- `seasons where college_id = cid and is_current and status = 'active'`
- `squad_matches where season_id = s.id`
- `task_submissions` / `tasks` joined to `student_profiles p where p.college_id = cid`
- `daily_marks where season_id = s.id`
- `student_portfolios` for `student_profiles where college_id = cid`, refused if any of them is not `is_demo_student`, and refused unless exactly 12 end up visible
