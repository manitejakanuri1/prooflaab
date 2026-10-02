# Complete frontend route and screen map (3 Oct 2026)

Read-only, **SRC** at HEAD `d736e4d` (`src/App.tsx`, the dashboard shells, `adminNav.ts`).

Classes:
- **C** = current
- **L** = legacy
- **M** = mixed (current screen reading legacy data)
- **O** = orphan (not reachable)

## 1. Top-level router (`src/App.tsx`, 27 `<Route>` entries)

| URL | Guard | Component | Class | Notes |
|---|---|---|---|---|
| `/` | public | Index | C | landing |
| `/auth` | public | Auth | C | email/password + Google; browser-only verified-email gate (F4) |
| `/auth/callback` | public | AuthCallback | C | |
| `/reset-password` | public | ResetPassword | C | |
| `/onboarding-wizard` | ProtectedRoute | OnboardingWizard | M | role picker (F5 self-claim) |
| `/onboarding/college` | ProtectedRoute | OnboardingCollege | C | |
| `/onboarding/startup` | ProtectedRoute | OnboardingStartup | C | company signup |
| `/onboarding/student` | ProtectedRoute | OnboardingStudent | M | |
| `/pricing` | public | Pricing | C | |
| `/portfolio/:slug` | public | Portfolio | **M** | public portfolio built on `proof_uploads` (L5) |
| `/recruiter/:linkId` | public | RecruiterView | **L** | share links: `recruiter_links` 0 rows, no way to create (L4) |
| `/student/start` | role student | StudentStart | C | intake choice |
| `/student/resume-onboarding` | student | StudentResumeOnboarding | C | |
| `/student/interest-onboarding` | student | StudentInterestOnboarding | C | Skip path |
| `/student/dashboard` | student | StudentDashboard | M | see §2 |
| `/student/tasks/*` | student | StudentDashboard (tab `lab`) | M | `?open=<task>` deep link |
| `/student/roadmap` | student | StudentDashboard (Profile → Roadmap) | C | |
| `/college/dashboard` | college_admin | CollegeDashboard | M | see §3 |
| `/college` | college_admin | CollegeDashboard (fallback) | C | duplicate entry to the same shell |
| `/company/dashboard` | startup, recruiter | StartupDashboard | M | see §4 |
| `/startup/dashboard` | — | redirect to `/company/dashboard` | C | |
| `/recruiter/dashboard` | — | redirect to `/company/dashboard` | C | |
| `/admin/dashboard` | admin | AdminDashboard | M | see §5 |
| `/admin/notifications` | admin | AdminNotifications | C | |
| `/admin/dashboard/user-management/:userType` | admin | user management | C | |
| `/review-proofs` | admin | ReviewProofs | **L** | duplicate of admin Proof Review (L2) |
| `*` | public | NotFound | C | |
| (lazy import, no route) | — | ProofViewer | **O** | imported in App.tsx, never routed (L8) |

Global component: `AppGuideChatbot` on every page calls `app-guide-chat` (DeepSeek, cached).

## 2. Student shell: 4 nav items, 17 sub-views (`StudentSidebar`, `StudentDashboardContent`)

| Nav | Sub-tab | Component | Backend (hook → API → tables) | Class |
|---|---|---|---|---|
| **Daily Card** (`lab`) | — | `StudentDailyCard` | RPC `my_todays_lot` → tasks (+ recruiters for the sponsor name); `lot-writer` (browser-triggered); `task-explain`; Voice modal | C |
| | — | `StudentAssignedTasksPage` "Your tasks" | `useAllStudentTasks` → tasks, task_assignments, task_submissions; realtime channels on **`proof_uploads`, `conceptual_tests`**; dead `UploadProofModal` / `ConceptualQuestionsModal` branches (`setSelectedTaskId` is never called with an id) | **M** (N7 label; 72 roadmap tasks listed) |
| **Build-Log** (`log`) | Entries | `StudentUploadsPage` | voice_explanations + task_submissions + **conceptual_tests** (+ realtime) | **M** |
| | Skills | `StudentSkillsProved` | student_skills (0 rows) | M |
| | Cosigns | `StudentCosigns` | cosigns RPCs (0 rows) | **L** (L3) |
| | History | `StudentHistory` | activity tables | M |
| | Progress | `CodingStreaks` + `StudentProgressPage` | `leetcode-streak-sync` (**L**) + task_submissions (fixed 2 Oct) | M |
| | Badges & Quests | `StudentAchievements` | student_badges, student_quests | C |
| **Squad** | — | `StudentSquadPage` | squads, squad_members, scores; teammate names "—" (N3, RLS) | C (bug) |
| **Profile** | Proof | `StudentResumeHistoryPage` | resume_scorecards, resume_assessments.answer_scores | C |
| | Roadmap | `StudentRoadmapPage` → LevelMap / LevelDetail | `levels-place`, `level-open`, `level-quiz-submit`, `run-code`; level_* tables; uses `proof_uploads` for status | **M** |
| | Resume | `StudentResumeCheckFlow` | `resume-parser`, `-improve`, `-question-generator`, `-retest-generate` | C |
| | Mock interview | `MockInterview` | `mock-interview-generate` / `-score` (0 rows) | C (low use) |
| | Certifications | `StudentCertifications` | student_certifications (0) | C |
| | Role preference | `StudentRolePreference` | student_profiles | C |
| | Privacy | `StudentPrivacy` | profile visibility + **proof privacy section** | **M** (L3) |
| | Portfolio | `StudentPortfolioPage` | `usePortfolioProjects` → **proof_uploads** | **M** (L5) |
| | Settings | `StudentSettingsPage` | profile | C |

Concept count a student sees today: 4 nav items + 6 + 9 tabs. The terms used include:

> Lot, Daily Card, Floor (docs), Build-Log, Entries, Skills, Cosigns, History, Progress, Badges, Quests, Squad, Proof, Roadmap, Track, Resume, Mock interview, Certifications, Privacy, Portfolio, Trust (in places), XP.

That is **about 22 concepts**, against an intent of 4.

Legacy tab ids still resolve (`LEGACY` map): dashboard, feed, uploads, applications, resume-jobmatch, resume-certs, jobs, learning and others.

## 3. College / TPO shell (`CollegeDashboardSidebar`, `CollegeDashboardContent`)

| Nav | Component | Backend | Class |
|---|---|---|---|
| Home | `TpoHome` (+ `PostJobDescription` → job_opportunities insert, `PostSourceMaterial` → `college_submit_source_content`) | `tpo_*` RPCs | C |
| Students | `TpoStudents` → `TpoStudentProfile`, `TpoImportStudents` (`create-student-users`), `AssignTasksScreen` (`assign_tasks`) | `tpo_students` (reads trust_score), `tpo_student_profile`, `tpo_student_learning` | **M** (TPO trust field, L3) |
| Squads | `TpoSquads` | squads RPCs | C |
| Insights | `TpoInsights` | `tpo_*` reports (migration 49: approved only) | C |
| footer | Notifications (`NotificationsSection`, proof-based hook), Profile, Settings | notifications | **M** |

Orphans (no importer): `UploadedProofs`, `TrustScoresSection`, `VerificationTrendsPage`, `VerificationSettingsPage`, `StudentsManagement` (+ `GenerateRecruiterLinkModal`), `RecruiterLinksPage`. All **O**.

## 4. Company shell (role `startup`; recruiter screens embedded)

| Nav | Sub-tab | Component | Backend | Class |
|---|---|---|---|---|
| Home | — | `StartupDashboardOverview` + `RecruiterDashboardContent(home)` | `recruiter_home`; `useStartupStats` / `Activity` (**proof_uploads**) | **M** |
| Talent | Search | `RecruiterDashboardContent(talent)` → `ProofProfile` | `recruiter_talent`, `recruiter_filters`, `recruiter_proof_profile`, `recruiter_log_view` | C (scale risk U6) |
| | Shortlist | same (shortlist) | `recruiter_shortlist`, recruiter_shortlists (0) | C |
| Work | Post Task | `StartupPostTaskPage` | tasks with `created_by_startup_id` | **duplicate system** |
| | My Tasks | `StartupViewTasksPage` | tasks | dup |
| | Applications | `StartupViewApplicationsPage` | task_applications (0) | dup |
| | Submissions | `StartupSubmissionsPage` → `useStartupSubmissions` | **proof_uploads**: broken (L1) | **L / broken** |
| | Sponsored Lots | `RecruiterDashboardContent(lots)` | `recruiter_lots` (**reads proof_uploads**), `sponsor_lot`, `record_outcome` | **broken** (results invisible) |
| Jobs | — | `StartupJobsPage` | job_opportunities | C |
| Settings | — | `StartupSettingsPage` | startups, startup_profiles | C |

Work and Jobs are hidden until the company is verified (`RestrictedAccessMessage`).

## 5. Admin shell (`adminNav.ts` ADMIN_GROUPS)

| Group | Item | Component | Class |
|---|---|---|---|
| Overview | Dashboard | `AdminDashboardOverview` (proof-based stats) | **M** |
| | Reports & Analytics | `AdminAnalytics` | **M** |
| People | Students / Companies / Colleges | `EnhancedUserManagement`, `RecruiterOversight` | C |
| | College Oversight / Student Oversight | `CollegeOversight` (`create-college-user`), `StudentOversight` (`create-student-users`) | C |
| Work Queue | Proof Review | `ProofSubmissionsContent` → `useFullVerification` (ai-authorship, github-check, question-generator, response-evaluator, trust-compute), `useVerifyProof` (verify-proof), `proofFile` | **L** (L2) |
| | Flagged | `ReviewedSubmissions` | C/M |
| | Task Oversight | `TaskOversight` | **M** |
| | Assign Tasks | `AdminAssignTasks` → `AssignTasksScreen` | C (trust filter: L) |
| | Trust & XP | `TrustXPModeration` (writes trust_score) | **L** |
| Platform | Jobs, Resources, Announcements | job_opportunities, learning_resources (0), announcements (0) | C |
| | Content Library | `ContentLibrary` (`admin_content_library`) | C |
| | Token Usage | `TokenUsage` (llm_usage: **empty since 11 Sep**, F3) | C (blind) |
| | Security Events | `SecurityEvents` | C (client events only) |
| | Student Trace | `StudentTrace` (app_events) | C |
| | Bug Finder | `BugFinder` (bug_finder_runs) | C |
| | Settings & Roles | `SystemSettings` | C |

## 6. Network and state behaviour of key screens (SRC, partial)

| Screen | Requests on open | Polling / realtime | Storage | Risks |
|---|---|---|---|---|
| Daily Card | `my_todays_lot`, explainer, possibly `lot-writer` | voice row polling while processing | voice recovery record (metadata only; audio never stored) | lot-writer runs per first student |
| Your tasks | tasks + assignments + submissions + conceptual_tests | **realtime subscriptions on `proof_uploads`, `conceptual_tests`** (legacy, wasted connections) | — | N+1 per task status (INFERRED from the per-task lookups) |
| Build-log Entries | voice + submissions + conceptual | realtime on conceptual_tests | — | mixed sources |
| Timed assessment | assessment + coding | timers | **localStorage progress** per assessment | timer reset on reload |
| Auth | Identity + bridge | refresh timer | **session incl. Google refresh token in localStorage** | XSS = session theft |
| Tracker | `client-log` every 5 s (students) | batch | in-memory queue | — |

## 7. Duplicates

- `/college` = `/college/dashboard`.
- `/review-proofs` = admin Proof Review.
- `/startup/dashboard` and `/recruiter/dashboard` redirect to `/company/dashboard`.
- Company Work has two task systems: Post Task/Submissions and Sponsored Lots.
- Student "Proof" tab (resume history) vs the legacy "proof" concept.
