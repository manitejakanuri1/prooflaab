# Authorization matrix (production, 1 Oct 2026)

Who may do what, and the live test that proves it. Tests use dedicated TEST logins only
(student `vidyuthsetu+smoke01`, the test college login, the admin login) and change nothing:
every write is a call that is expected to be refused, and is checked to have been refused.

Re-run:
- `python scripts/dev-tools/authz_matrix_check.py` — per-role checks (signed-in test logins).
- `python scripts/dev-tools/attack_surface_check.py` — anonymous and forged-token checks against every public endpoint.

## How access is decided

| Layer | Rule |
|---|---|
| Login | Identity Platform (Google or email/password) -> `prooflab-auth-bridge` issues the app JWT with the user id; role comes from `user_roles`. |
| Tables | PostgREST as role `authenticated`; row-level security on every table. |
| Reports and admin tools | SECURITY DEFINER RPCs that check the caller's role inside the function. |
| Server-only RPCs | EXECUTE revoked from `anon` and `authenticated`; only the service role (functions, worker) may call. |
| Functions | Each function checks the app JWT and role before acting. |
| Worker | Cloud Run IAM: only `prooflab-tasks-invoker` (Cloud Tasks) may call it. |
| Scheduled endpoints | `x-webhook-secret` header required. |
| Code runner | runner secret header required. |

## Matrix

| Resource / action | Anonymous | Student | College | Company | Admin | Server only |
|---|---|---|---|---|---|---|
| Own student profile | no | own row only | own college's students | no | all | — |
| Other students' tasks / submissions / voice | no | no | own college only | no | all | — |
| Student contact details | no | own only | own college | no | all | — |
| Change a voice score | no | no | no | no | no | yes (`complete_voice_scoring`) |
| Change a task's settings (`task_rubric_config`) | no | no (0 rows) | no (0 rows) | no | yes | — |
| `admin_trace_search`, `admin_bug_finder_runs` | no | no | no | no | yes | — |
| `tpo_college_report`, `tpo_placement_report` | no | **yes — WRONG (G28)** | yes | no | via college | — |
| `claim_transcription_job`, `claim_transcription_recovery`, `record_task_submission` | no | no | no | no | no | yes |
| Create student / college logins | no | no | yes (own college) | no | yes | — |
| Private worker | no | no | no | no | no | Cloud Tasks only |
| Scheduled endpoints (`scheduled-job`, `transcription-reap`) | no (secret) | no | no | no | no | Cloud Scheduler |
| Private files | no | own | own college | no | yes | — |

"no" for students/anonymous and all server-only rows are covered by live checks below. "yes" cells for
college/admin on logins and files are by design and exercised by the live dashboards; they were not
separately probed by the scripts.

## Live results (1 Oct 2026)

`authz_matrix_check.py` (first run, 1 Oct): 20 of 25 passed. **Re-run after G10 (1 Oct): 52 of 53** — the only failure is G28 (student reads the placement report); the two rubric false alarms and the worker 401 are now counted correctly by the script. The 5 that did not pass:

| Check | Result | Verdict |
|---|---|---|
| Student calls `tpo_placement_report` | 200 with data | **Real finding G28 (P1).** The report resolves the college from the student's own profile. Fix = Migration 49 (prepared, rehearsed on staging, not applied; owner command 6). 0 hires recorded, so nothing sensitive was exposed. |
| Student changes a task's `scratch_language` | 204, 0 rows changed | False alarm: PATCH with no return body. Re-read showed the row still `python`. Denied by row-level security. |
| College changes a task's `scratch_language` | 204, 0 rows changed | Same as above; denied. |
| Student ticket on the private worker | 401 (test expected 403) | Denied either way (Cloud Run refuses a non-Google token with 401). |
| Company test login | created 1 Oct (`vidyuthsetu+company01`, verified) | Closed G10: 32/32 company checks pass (below). |

`attack_surface_check.py`: 66 of 66 passed (anonymous and forged tokens refused on PostgREST tables and
RPCs, all 16 login-only functions, scheduled endpoints, auth bridge, files, accounts, transcriber, code runner;
no stack traces or secrets in error bodies).

## Known and accepted

- Transcriber `/transcribe` is callable by any signed-in user (the mock interview needs it). Limits: 15 MB
  upload cap, 1 request per instance, max 3 instances. Accepted P2.
- PostgREST error messages name tables and functions (for example "Could not find the function"). No data or
  secrets. Accepted P3.

## Company (G10, 1 Oct 2026)

Test company `ProofLab TEST Company Smoke` (`vidyuthsetu+company01`), verified recruiter, role `startup`.

| Check | Result |
|---|---|
| Own role / verified | `startup`, `is_verified_recruiter` = true |
| Private student data: `student_profiles`, `student_contact`, `voice_explanations`, `task_submissions`, `tasks`, `resume_claims`, `resume_scorecards` | 0 rows each |
| Other colleges' / platform data: `colleges`, `student_imports`, `recruiter_links`, `task_rubric_config`, `notifications` | 0 rows each |
| `app_events`, `removed_students` | 403 |
| Admin RPCs, server-only RPCs | refused (400 "admins only" / 404) |
| College reports `tpo_placement_report`, `tpo_college_report` | refused ("Only a college can read this report") |
| Proof profile of a non-public student | "No candidate found" (nothing leaked) |
| Talent search | runs (200); returns only students who chose to be discoverable (none yet) |
| Change a task config | 0 rows changed |
| `create-student-users`, `create-college-user` | 403 |
| Private worker | 401 |
| A student's private recording (files service) | company 404; the owning student 200 (control) |
| Browser (`company_dashboard_browser.mjs`, live) | Home, Talent, Work, Jobs open with content, no 4xx/5xx or CORS errors; `/admin`, `/college`, `/student` dashboards redirect back to `/company/dashboard` |

Not proven: the Talent list with real candidates, because no student has chosen to be discoverable
yet. Making one would change a student's visibility, so it was not done.
