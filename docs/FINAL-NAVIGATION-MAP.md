# Final navigation map

Read from the code on `work/stabilization` (router `src/App.tsx`, the four sidebars, the four dashboard content switches), not from screenshots or old documents. Staging only; production still serves the old menus.

**Rule:** every role has exactly four main destinations. Everything else is a tab inside one of them. The destination and the inner tab are in the address (`?tab=…&view=…`), so refresh, pasted links and Back/Forward work (`src/hooks/useUrlTab.ts`). Proven in the browser: 31/31 steps.

## Routes (25 → 25; none added)

| Route | Component | Decision |
|---|---|---|
| `/`, `/auth`, `/auth/callback`, `/reset-password`, `/pricing` | public pages | KEEP |
| `/onboarding-wizard`, `/onboarding/college`, `/onboarding/startup`, `/onboarding/student` | onboarding | KEEP |
| `/student/start`, `/student/resume-onboarding`, `/student/interest-onboarding` | intake | KEEP |
| `/student/dashboard` | StudentDashboard | KEEP — all four student destinations |
| `/student/tasks/*` | StudentDashboard | REDIRECT-ONLY alias → Floor (Roadmap "Start" opens `/student/tasks/assigned?open=<task>`) |
| `/student/roadmap` | StudentDashboard | REDIRECT-ONLY alias → Profile › Roadmap |
| `/portfolio/:slug` | Portfolio | KEEP — public page of passed Lots |
| `/college/dashboard` | CollegeDashboard | KEEP |
| `/college` | redirect | REDIRECT → `/college/dashboard` |
| `/company/dashboard` | StartupDashboard | KEEP |
| `/startup/dashboard`, `/recruiter/dashboard` | `<Navigate>` | REDIRECT → `/company/dashboard` (no logic) |
| `/admin/dashboard` | AdminDashboard | KEEP |
| `/admin/dashboard/user-management/:userType` | AdminDashboard | REDIRECT-ONLY alias → People › Students / Colleges / Companies |
| `/admin/notifications` | admin notifications | KEEP (header bell) |
| `/recruiter/:linkId`, `/review-proofs` | — | REMOVED earlier (proof-era) |

## Student — 4

| Before (label) | After | Inside it (tab → component → data) |
|---|---|---|
| Daily Card | **Floor** `?tab=lab` | Today's Lot + open tasks → `StudentDailyCard`, `StudentAssignedTasksPage` → `tasks`; Run/Submit → `run-sandbox`, `submit-sandbox-task`, `submit-written-task`; then the recorder → `transcription-enqueue` |
| Build-Log | **Build-log** `?tab=log` | Recent work → `BuildLogEntries` (`task_submissions` + `voice_explanations`) · Progress → `StudentProgressPage` · Skills evidence → `StudentSkillsProved` (`student_skills`) · History → `StudentHistory` (`student_activity_events`) |
| Squad | **Squad** `?tab=squad` | `StudentSquadPage` → `my_squad_members()`, `squads`, `squad_matches`, `my_squad_achievements()` |
| Profile | **Profile** `?tab=profile` | Readiness (resume scorecards) · Roadmap · Resume · Mock interview · Certifications · Badges (moved here from Build-log; real `badges`/`student_badges`/`quests`) · Role preference · Portfolio (`portfolio_work()`) · Privacy · Settings |

Menu count: 4 → 4. Changed: labels (Floor, Build-log), Build-log tabs regrouped to the four evidence views, Badges moved to Profile. Old ids (`uploads`, `progress`, `portfolio`, `resume`, `jobs`, …) resolve to the right destination through a lookup with no logic.

## College (TPO) — 4

| Destination | Component | Data |
|---|---|---|
| **Home** | `TpoHome` | `tpo_home()`, `tpo_attention()` |
| **Students** `?tab=students` | `TpoStudents`, `TpoStudentProfile`, `TpoImportStudents` | `tpo_students()`, `tpo_student_profile()`, `tpo_student_learning()`, `create-student-users` |
| **Squads** `?tab=squads` | `TpoSquads` | `squads`, `squad_members`, `tpo_squad_performance()`, `tpo_form_squads()` |
| **Insights** `?tab=insights` | `TpoInsights` | `tpo_students()`, report functions |

Menu count: 4 → 4. Changed: tab is now in the address. Account chrome (bell = students needing attention, college profile, settings) is in the header/footer, not the menu.

## Company — 7 → 4

| Before | After |
|---|---|
| Home | **Home** |
| Talent | **Talent** `?tab=talent` — search, filters, candidate profile, shortlist action (`recruiter_talent()`, `recruiter_proof_profile()`) |
| Lots | **Lots** `?tab=lots` › My Lots (`recruiter_lots()`) |
| Submissions | MERGED → Lots › Submissions `?tab=lots&view=submissions` (`company_submissions()`) |
| Review | MERGED → Lots › Reviews `?tab=lots&view=reviews` (`company_review_submission()`) |
| — | Lots › Create a Lot `?view=create` (pick a shortlisted candidate → `company-lot`: coding = real tests, written = its own rubric) |
| Shortlist | MERGED → **Hiring** › Shortlist `?tab=hiring` (pipeline stage, response, outcome: `recruiter_shortlists`) |
| Jobs | MERGED → Hiring › Job posts `?tab=hiring&view=jobs` (`job_opportunities`; **current**: approved posts are a source for Lots) |

Redirect-only ids (lookup `COMPANY_REDIRECTS`, no logic): `shortlist`→Hiring, `jobs`→Hiring › Job posts, `submissions`→Lots › Submissions, `review`→Lots › Reviews, `post-task`→Lots › Create, `view-tasks`/`work`→Lots, `view-applications`→Lots › Reviews.

Removed with this change: `StartupDashboardOverview`, `useStartupStats`, `useStartupActivity`, `useStartupTasks`, `useTaskApplications` (the old "post a task / applications" marketplace: **removed**, not future — it never worked on this backend).

## Admin — 4 (renamed and regrouped)

| Before | After | Pages inside |
|---|---|---|
| Overview | **Home** | Overview · Reports · Announcements |
| People | **People** | Students · Colleges · Companies · College users · Student oversight · Admins & roles |
| Work Queue | **Work** | Lots & tasks · Submissions · Flags & reviews · Assign tasks · Content library · Job sources · Resources |
| Platform | **Operations** | AI usage · Jobs & health (new: `AdminOpsHealth`) · Security & audit · Errors & traces · Bug finder |

All pages open with `/admin/dashboard?tab=<id>`.
