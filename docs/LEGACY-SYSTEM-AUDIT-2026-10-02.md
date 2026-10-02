# Legacy system dependency audit — 2 Oct 2026 (READ-ONLY)

Scope: the whole repository on the current branch. Nothing was edited, deleted, deployed or run
against a database except read-only row counts through the API. This file is not committed.

## 0. Repository state

| Item | Value |
|---|---|
| Current branch | `work/step6j-release-gates` |
| Current HEAD | `d736e4dd95925aeaa017200d06033bf0d92c77fa` |
| `main` HEAD (prooflaab) | `d736e4dd95925aeaa017200d06033bf0d92c77fa` |
| `work/step6j-release-gates` HEAD (prooflaab) | `d736e4dd95925aeaa017200d06033bf0d92c77fa` |
| Current branch vs main | identical (0 ahead / 0 behind) |
| git status | clean for tracked files; untracked: 7 old `docs/STEP6-*AUDIT*` reports, `authz_matrix_results.json`, `transcription-worker/__pycache__/`, `voice-playback-fail.png` |

## 1. Method (how "reachable" was decided)

1. **Frontend import graph:** every `.ts/.tsx` file in `src/` (288 files), with static imports,
   `export … from`, and dynamic `import()` / `lazy()` resolved, walked from `src/main.tsx`. 263 files
   are reachable. A reachable file is then checked against a **real route or navigation entry**,
   because an import alone does not mean a user can open it. For example, `App.tsx` lazy-imports
   `ProofViewer` but no `<Route>` renders it.
2. **Routes and navigation:** every `<Route>` in `src/App.tsx`, the student destinations and tabs
   (`StudentDashboardContent.tsx`), the college sidebar (`CollegeDashboardSidebar.tsx`), the admin
   menu (`adminNav.ts`) and its `case` mapping (`pages/AdminDashboard.tsx`), and the company sidebar
   (`StartupSidebar.tsx`).
3. **Server:** the `SLUGS` registration in `functions-service/main.ts`; every caller of each legacy
   function (frontend, other functions, worker, scripts, CI); all 13 Cloud Scheduler targets.
4. **Database:** the latest definition of every function and trigger in the migration history
   (`supabase/migrations` then `migration/`, in order; dropped objects excluded), checked for legacy
   tables. Production row counts were read with a service token (count only).
5. Keywords such as "proof", "github" and "upload" were **not** taken as evidence by themselves.
   Every hit was traced.

## 2. Production data in the legacy tables (read-only counts, 2 Oct 2026)

| Table | Rows | | Table | Rows |
|---|---|---|---|---|
| proof_uploads | **0** | | proof_appeals | **0** |
| trust_scores | **0** | | coding_streaks | **0** |
| conceptual_tests | **0** | | recruiter_links | **0** |
| conceptual_answer_keys | **0** | | recruiter_link_views | **0** |
| cosigns | **0** | | task_applications | 0 |
| github_verifications | **0** | | job_opportunities | 0 |
| ai_verifications | **0** | | *current:* task_submissions / voice_explanations / student_profiles | 14 / 12 / 17 |

There is **no historical legacy data in production**. "Historical viewers" therefore have nothing
to show. Staging data was not counted.

## 3. Current routes and what they reach

| Route | Who | Status |
|---|---|---|
| `/student/dashboard`, `/student/tasks/*`, `/student/roadmap` | student | current |
| `/college/dashboard`, `/college` | college | current |
| `/company/dashboard` (`/startup/*` and `/recruiter/dashboard` redirect here) | company | current |
| `/admin/dashboard`, `/admin/notifications`, `/admin/dashboard/user-management/:userType` | admin | current |
| `/review-proofs` → `ReviewProofs` (full admin-dashboard duplicate incl. Proof Review + Trust & XP) | admin | **legacy duplicate** |
| `/portfolio/:slug` → `Portfolio` | public | partly legacy (projects = proof_uploads) |
| `/recruiter/:linkId` → `RecruiterView` | public | **legacy** (recruiter_links + trust_score + proof_uploads) |
| *(none)* `ProofViewer` | — | lazy-imported in App.tsx but **no route renders it** |

Navigation that opens legacy screens: Admin → Work Queue → **"Proof Review"** (`ProofSubmissionsContent`)
and **"Trust & XP"** (`TrustXPModeration`); Admin Overview has a quick-link to "proof-submissions";
Student → Build-Log → **Entries** (old "My Uploads" + current voice card), **Cosigns**, **Progress**
(Trust Score + CodingStreaks); Student → Profile → **Portfolio** (proof projects, trust score) and
**Privacy** (proof visibility); Company → Work → **Submissions** (proof_uploads).

## 4. The 15 specific findings

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 1 | StudentProgressPage shows Trust Score, reads `trust_scores` | **Old, visible** | Live (Build-Log → Progress). `trust_scores` = 0 rows; `profile.trust_score` never written now |
| 2 | StudentDashboardContent exposes Cosigns and CodingStreaks | **Old, visible** | Tabs "Cosigns" and Progress → `CodingStreaks` are live |
| 3 | CodingStreaks has LeetCode, HackerRank, GitHub, LinkedIn | **Old, visible; partly current** | Streaks: `coding_streaks` 0 rows. GitHub/LinkedIn links are saved to `student_contact` and **returned to recruiters by current `recruiter_proof_profile` (migration 46)** |
| 4 | StudentUploadsPage reads proof_uploads and conceptual_tests | **Mixed** | It is the **Entries** tab: an old "My Uploads" list (always empty) **plus the current `StudentVoiceExplanationsCard`** |
| 5 | StudentAssignedTasksPage holds UploadProofModal/conceptual code | **Old, unreachable inside a live file** | `setSelectedTaskId` is only ever set to `null`, so the upload dialog can never open; quiz buttons need a `conceptual_tests` row (0 exist) |
| 6 | Admin nav exposes Proof Review and Trust & XP | **Old, visible** | `adminNav.ts` ids `proof-submissions`, `xp-moderation`; mapped in `AdminDashboard.tsx` |
| 7 | ProofSubmissionsContent runs old verification | **Old, visible** | Calls verify-proof / github-check / ai-authorship / trust-compute / question-generator / response-evaluator via `useVerifyProof` and `useFullVerification` |
| 8 | TrustXPModeration reads/writes proof_uploads and trust_score | **Old, visible (writes!)** | Live via admin nav and `/review-proofs` |
| 9 | TPO student profile exposes trust_score | **Old, visible** | `TpoStudentProfile` shows "Trust score"; DB `tpo_student_profile` / `tpo_students` return it |
| 10 | Company StartupSubmissions reads/reviews proof_uploads | **Old, visible — and the company has no replacement** | Students now answer company tasks into `task_submissions`; this screen only reads `proof_uploads`, so a company sees nothing |
| 11 | RecruiterView filters by trust_score, reads verified proof_uploads | **Old, public-reachable, unusable** | `/recruiter/:linkId` needs a `recruiter_links` row; 0 exist and the only creators (`RecruiterLinksPage`, `GenerateRecruiterLinkModal`) are orphaned. The current recruiter path is the company dashboard (`recruiter_talent`, `recruiter_proof_profile`) |
| 12 | functions-service registers retired endpoints | **True** | `SLUGS` includes ai-authorship, github-check, leetcode-streak-sync, proof-file-url, question-generator, response-evaluator, submit-conceptual-answers, trust-compute, verify-proof |
| 13 | proof-file-url has an active frontend caller | **True** | `lib/proofFile.ts` → `ProofFileButton` (StudentUploadsPage), `StudentPortfolioPage`, `PublicProjectCard` (Portfolio), `RecruiterView`, `StartupSubmissionsPage`, `ProofSubmissionsContent` — all proof_uploads-based |
| 14 | useAllStudentTasks has proof_uploads branches | **Old compatibility** | Joins `proof_uploads` to derive status; current tasks are `sandbox/rubric` and never create proof rows |
| 15 | transcription-enqueue accepts proof_id and checks proof_uploads | **Old compatibility** | No frontend passes `proofId` to `VoiceExplainModal`; the DB guard `guard_voice_explanations_insert` also validates `proof_id` |

## 5. Full classification table

Legend: R = reachable from a real route/menu. Tables/functions are what the item reads, writes or calls.

### Student

| File | Name | Called by | R | Tables | Server fns | Breaks if removed | Replacement | Class |
|---|---|---|---|---|---|---|---|---|
| student/StudentDailyCard.tsx, WrittenTaskPanel, SandboxTaskPanel, VoiceExplainModal, StudentVoiceExplanationsCard, RecordingPlayback | current task + voice flow | dashboard | yes | tasks, task_submissions, task_rubric_config, voice_explanations | submit-*, run-*, transcription-enqueue, voice-score | everything | — | KEEP_CURRENT |
| student/StudentProgressPage.tsx | Trust Score card, Trust history chart, Progress-indicator trust bar | Build-Log → Progress | yes | trust_scores, student_profiles.trust_score | — | nothing (always 0) | remove the trust parts; keep points + submission cards | REMOVE_UI_NOW |
| student/CodingStreaks.tsx | LeetCode + HackerRank streaks | Progress | yes | coding_streaks (0 rows) | leetcode-streak-sync | nothing in use | none | REMOVE_UI_NOW |
| student/CodingStreaks.tsx | GitHub / LinkedIn profile links | Progress | yes | student_contact.github_url/linkedin_url | — | recruiters stop seeing links in `recruiter_proof_profile` | decide: drop, or move to Profile → Settings | UNKNOWN_NEEDS_DECISION |
| student/StudentCosigns.tsx | Cosigns tab | Build-Log | yes | cosigns, proof_uploads (via cosignable_proofs / my_cosigns / cosign_proof RPCs) | — | nothing (0 rows, needs proofs) | none | REMOVE_UI_NOW |
| student/StudentUploadsPage.tsx | Entries tab: "My Uploads", appeals, reflections, conceptual quiz | Build-Log → Entries | yes | proof_uploads, conceptual_tests, proof_appeals | proof-file-url, submit-conceptual-answers | **the current voice card lives here** | new Entries = `StudentVoiceExplanationsCard` (+ task submissions list) | REPLACE_BEFORE_REMOVE |
| AppealSubmissionModal, ReflectionModal, useProofAppeals, useReflectionRequest | proof appeals/reflections | StudentUploadsPage | yes | proof_uploads, proof_appeals | — | nothing | — | REMOVE_CODE_NOW (with StudentUploadsPage rewrite) |
| student/StudentAssignedTasksPage.tsx | UploadProofModal + conceptual quiz branches + proof_uploads realtime subscription | dashboard (list) | file yes, branches **no** | proof_uploads, conceptual_tests | question-generator (via modal) | nothing (branches unreachable) | — | REMOVE_CODE_NOW |
| student/StudentAssignedTasksPage.tsx | the task list itself | dashboard under Daily Card | yes | tasks | — | students lose their task list | move into Roadmap as "Your tasks" (owner request) | KEEP_CURRENT (relocate) |
| dashboard/UploadProofModal.tsx | proof upload dialog | StudentAssignedTasksPage (never opened) | no | proof_uploads | question-generator | nothing | — | REMOVE_CODE_NOW |
| student/ConceptualQuestionsModal.tsx, hooks/useConceptualTests.tsx | conceptual quiz | StudentAssignedTasksPage, StudentUploadsPage | no in practice | conceptual_tests | submit-conceptual-answers | nothing | — | REMOVE_CODE_NOW |
| hooks/useAllStudentTasks.tsx | proof_uploads join + status branches | task list | yes | proof_uploads | — | status logic must still work for current tasks | derive status from tasks/task_submissions only | REPLACE_BEFORE_REMOVE |
| student/StudentRoadmapPage.tsx | `proof_uploads(status)` join for roadmap task state | Profile → Roadmap | yes | proof_uploads | — | roadmap stage state | use tasks.status / task_submissions | REPLACE_BEFORE_REMOVE |
| student/StudentPortfolioPage.tsx | Portfolio: proof projects, trust score, publicity toggle | Profile → Portfolio | yes | proof_uploads, student_portfolios, trust_score | proof-file-url, set_proof_publicity | public portfolio editing | portfolio from passed task_submissions + voice | REPLACE_BEFORE_REMOVE |
| student/StudentPrivacy.tsx | proof visibility list | Profile → Privacy | yes | proof_uploads | set_proof_publicity | the proof-visibility section only (rest current) | drop that section | REMOVE_UI_NOW (section only) |
| hooks/useProofUploads.tsx | proof list hook | StudentPortfolioPage, StudentUploadsPage | yes | proof_uploads | — | those two screens | with their replacement | REPLACE_BEFORE_REMOVE |
| hooks/useStudentProfile.tsx, lib/ensureStudentProfile.ts | `trust_score` field / default 0 | everywhere | yes | student_profiles | — | type/column refs only | drop the field after column decision | HISTORICAL_KEEP_TEMPORARILY |
| student/GivenMaterial.tsx | (keyword false positive) | WrittenTaskPanel | yes | — | — | — | — | KEEP_CURRENT |

### College

| File | Name | Called by | R | Tables | Server fns | Breaks if removed | Replacement | Class |
|---|---|---|---|---|---|---|---|---|
| college/TpoHome, TpoStudents, TpoSquads, TpoInsights, TpoImportStudents… | current college dashboard | sidebar | yes | current tables | create-student-users, accounts | everything | — | KEEP_CURRENT |
| college/TpoStudentProfile.tsx + TpoStudents.tsx | "Trust score" field | Students | yes | tpo_student_profile / tpo_students (return trust_score) | — | nothing (always 0/—) | remove field | REMOVE_UI_NOW |
| college/NotificationsSection.tsx, hooks/useCollegeNotifications.ts | proof-upload notifications | college header / content | yes | proof_uploads | — | the proof part of notifications (always empty) | notifications from task_submissions needs_review | REPLACE_BEFORE_REMOVE |
| college/StudentsManagement, StudentProfileModal, GenerateRecruiterLinkModal, RecruiterLinksPage, TrustScoresSection, UploadedProofs, VerificationSettingsPage, VerificationTrendsPage, CollegeDashboardOverview | old college screens | nobody (orphans) | no | proof_uploads, trust_scores, recruiter_links, verification_settings | trust-compute, response-evaluator, proof-file-url | nothing | — | REMOVE_CODE_NOW |
| college/AssignTasks.tsx | old assign screen | nobody | no | — | — | nothing | current: AdminAssignTasks / AssignTasksScreen | REMOVE_CODE_NOW |

### Admin

| File | Name | Called by | R | Tables | Server fns | Breaks if removed | Replacement | Class |
|---|---|---|---|---|---|---|---|---|
| admin/ProofSubmissionsContent.tsx (+ useVerifyProof, useFullVerification) | **Proof Review** | menu `proof-submissions`, `/review-proofs` | yes | proof_uploads, github_verifications, ai_verifications, conceptual_tests, trust_scores | verify-proof, github-check, ai-authorship, trust-compute, question-generator, response-evaluator, proof-file-url | nothing in use (0 proofs) | none (current review = "Flagged") | REMOVE_UI_NOW |
| admin/TrustXPModeration.tsx | **Trust & XP** (writes trust_score) | menu `xp-moderation`, `/review-proofs` | yes | proof_uploads, student_profiles.trust_score, xp | — | XP adjustment tool | keep an XP-only adjustment (xp_logs/manual_adjustment_log) | REPLACE_BEFORE_REMOVE |
| admin/ReviewedSubmissions.tsx | **Flagged** (needs_review task_submissions) | menu | yes | task_submissions | needs_review_submissions, review_task_submission | current human review | — | KEEP_CURRENT |
| pages/ReviewProofs.tsx | `/review-proofs` duplicate admin dashboard | route | yes | as above | as above | nothing (admin dashboard covers it) | `/admin/dashboard` | REMOVE_UI_NOW |
| admin/AdminDashboardOverview.tsx | proof counts + "proof-submissions" quick link | Overview | yes | proof_uploads | — | 2 stat tiles | stats from task_submissions | REPLACE_BEFORE_REMOVE |
| admin/AdminAnalytics.tsx | proof charts | Reports & Analytics | yes | proof_uploads | — | analytics charts | task_submissions-based charts | REPLACE_BEFORE_REMOVE |
| admin/EnhancedUserManagement.tsx | proofs_submitted + trust column | People | yes | proof_uploads, trust_score | — | 2 columns | submissions count from task_submissions | REPLACE_BEFORE_REMOVE |
| admin/TaskOversight.tsx + ViewAssignedStudentsModal | proof list per task | Task Oversight | yes | proof_uploads | — | per-task progress | task_submissions per task | REPLACE_BEFORE_REMOVE |
| assignTasks/AssignTasksScreen.tsx + lib/studentFilters.ts | trust-score filter | Assign Tasks | yes | student_profiles.trust_score | — | the filter (useless at 0) | drop filter | REMOVE_UI_NOW |

### Company / startup

| File | Name | Called by | R | Tables | Server fns | Breaks if removed | Replacement | Class |
|---|---|---|---|---|---|---|---|---|
| startup Home/Talent/Jobs, StartupPostTaskPage, recruiter_talent, recruiter_proof_profile | current company flow | sidebar | yes | current + proof_uploads compat branch in RPCs | — | everything | — | KEEP_CURRENT |
| startup/StartupSubmissionsPage.tsx + useStartupSubmissions | Work → **Submissions** | sidebar | yes | proof_uploads | proof-file-url | companies would have no submissions screen (today it shows nothing anyway) | read task_submissions for `tasks.created_by_startup_id` | REPLACE_BEFORE_REMOVE |
| hooks/useStartupStats.tsx, useStartupActivity.tsx | company stats/activity | Overview | yes | proof_uploads | — | stat tiles/feed | task_submissions-based | REPLACE_BEFORE_REMOVE |
| startup/StartupViewTasksPage.tsx | comment about proof_uploads FK (delete blocked) | My Tasks | yes | — | — | — | — | KEEP_CURRENT |
| recruiter/RecruiterDashboardSidebar.tsx, pages/RecruiterDashboard.tsx | old recruiter dashboard | nobody (route redirects) | no | — | — | nothing | company dashboard | REMOVE_CODE_NOW |
| hooks/useStartupNotifications.tsx | old | nobody | no | — | — | nothing | — | REMOVE_CODE_NOW |

### Public / recruiter

| File | Name | Called by | R | Tables | Server fns | Breaks if removed | Replacement | Class |
|---|---|---|---|---|---|---|---|---|
| pages/RecruiterView.tsx | `/recruiter/:linkId` | public route | yes, but no link can exist | recruiter_links (0), proof_uploads, trust_score | proof-file-url | nothing in use | company dashboard (verified recruiters) | UNKNOWN_NEEDS_DECISION (remove route vs rebuild share links) |
| pages/Portfolio.tsx + usePortfolio, usePortfolioProjects, PublicProjectCard, PublicSuggestedStudents | `/portfolio/:slug` | public route | yes | student_portfolios, proof_uploads, trust_score | proof-file-url | public portfolio pages | portfolio from task_submissions + voice | REPLACE_BEFORE_REMOVE |
| pages/ProofViewer.tsx, components/proof/ProofFileButton.tsx, lib/proofFile.ts | proof file viewer | ProofViewer: no route; ProofFileButton/proofFile: used by StudentUploadsPage etc. | ProofViewer no; others via their parents | proof_uploads | proof-file-url | nothing once parents are replaced | — | ProofViewer REMOVE_CODE_NOW; ProofFileButton/proofFile REMOVE_CODE_NOW after their parents |
| public/ContactStudentModal.tsx | contact modal | nobody | no | trust_score, links | — | nothing | — | REMOVE_CODE_NOW |

### Shared / other orphans (no route, no import, no dynamic import, confirmed by repository-wide name search)

`dashboard/EnhancedVerificationModal.tsx`, `dashboard/IntegrityContextPanel.tsx`, `dashboard/NotificationsSection.tsx`,
`dashboard/TrustTrendBadge.tsx`, `hooks/useMonthlyXP.tsx`, `hooks/useProofReviews.tsx`, `hooks/useTaskStats.tsx`,
`hooks/useVerificationSettings.tsx`, plus the college, recruiter and public orphans listed above (22 files in total). → **REMOVE_CODE_NOW**

### Server functions (functions-service SLUGS)

| Function | Current callers | Calls | Tables | Breaks if removed now | Class |
|---|---|---|---|---|---|
| verify-proof | ProofSubmissionsContent (useVerifyProof) | AI | proof_uploads, github/ai_verifications, trust_scores | Proof Review buttons | REMOVE after Proof Review UI (E) |
| github-check | useFullVerification | GitHub | github_verifications, proof_uploads | Proof Review | REMOVE after UI (E) |
| ai-authorship | useFullVerification | AI | ai_verifications, proof_uploads | Proof Review | REMOVE after UI (E) |
| trust-compute | useFullVerification, submit-conceptual-answers, UploadedProofs (orphan) | — | trust_scores, proof_uploads, voice | Proof Review | REMOVE after UI (E) |
| question-generator | UploadProofModal (never opens), useFullVerification | AI | conceptual_tests, proof_uploads | nothing reachable except Proof Review | REMOVE after UI (E) |
| response-evaluator | useFullVerification, submit-conceptual-answers | AI | conceptual_tests | Proof Review | REMOVE after UI (E) |
| submit-conceptual-answers | ConceptualQuestionsModal (never reachable) | trust-compute, response-evaluator | conceptual_tests | nothing | REMOVE after UI (E) |
| proof-file-url | 6 frontend callers (§4 #13) | storage | proof_uploads | those screens | REMOVE after Entries/Portfolio/Submissions/RecruiterView replaced (E) |
| leetcode-streak-sync | CodingStreaks | LeetCode | coding_streaks | LeetCode box | REMOVE after CodingStreaks UI (E) |
| transcription-enqueue `proof_id` branch | no frontend sender | — | proof_uploads | nothing | REPLACE_BEFORE_REMOVE (drop the parameter together with the DB guard branch) |

Not called by any scheduler (all 13 targets checked), Cloud Task, worker, script or CI (except
`authz_test.ts` / `attack_surface_check.py`, which list them as endpoints to test and must be updated
when they go).

### Database (latest definitions in the migration history)

| Object | Legacy use | Class |
|---|---|---|
| Triggers on proof_uploads: `proof_uploads_record_activity` → on_proof_change, `proof_uploads_review_effects` → on_proof_reviewed, `proof_uploads_reject_sandbox`, `protect_proof_uploads`; `protect_conceptual_tests`; `protect_coding_streaks`, `coding_streaks_set_updated_at` | fire only on legacy tables (0 rows) | HISTORICAL_KEEP_TEMPORARILY → drop with their tables |
| `guard_voice_explanations_insert` (trigger on **voice_explanations**) | validates `proof_id` against proof_uploads | REPLACE_BEFORE_REMOVE (remove that branch before dropping proof_uploads) |
| `record_activity`, `recruiter_home`, `recruiter_lots`, `recruiter_talent`, `recruiter_proof_profile`, `tpo_student_profile`, `remove_students` | **current** functions that still count/join proof_uploads (compat branches, e.g. stage69 "verified proofs + passed submissions") | REPLACE_BEFORE_REMOVE (rewrite without proof_uploads before dropping it; recruiter ones together with on-hold Migration 46) |
| `tpo_students`, `form_squads`, `get_leaderboard` | read `trust_score` | REPLACE_BEFORE_REMOVE (before dropping the column) |
| `cosign_proof`, `cosignable_proofs`, `my_cosigns`, `set_proof_publicity` | legacy-only RPCs | REMOVE after UI (E) |
| Tables: proof_uploads, trust_scores, conceptual_tests, conceptual_answer_keys, cosigns, github_verifications, ai_verifications, proof_appeals, coding_streaks, recruiter_links, recruiter_link_views, verification_settings; column student_profiles.trust_score | 0 rows each | HISTORICAL_KEEP_TEMPORARILY until the final cleanup |

---

## A. Current architecture that should remain

Student: Daily Card → written (rubric + optional scratchpad) / coding (sandbox) → `task_submissions`;
voice → files → transcription-enqueue → Cloud Tasks → worker → Whisper → voice-score → Build-Log
voice card; Tracks/Roadmap; squads/seasons; resume flow; mock interview. College: Home, Students,
Squads, Insights, import/removal. Admin: Overview (needs new stats), People, **Flagged** review,
Task Oversight (needs new data), Assign Tasks, Content Library, Token Usage, Security Events,
Student Trace, Bug Finder, Settings. Company: Home, Talent (`recruiter_talent`), Work (post tasks),
Jobs. All 31 non-legacy functions, the scheduler jobs, the reaper and worker.

## B. Old architecture still active (visible to users today)

Admin **Proof Review** and **Trust & XP** (and the `/review-proofs` duplicate); student **Trust Score**
card/chart, **Cosigns** tab, **LeetCode/HackerRank/GitHub/LinkedIn** box, **"My Uploads"** in Entries,
proof section in Privacy, trust score + proof projects in Portfolio; college **trust score** on
student list/profile and proof **notifications**; admin proof **stats/charts/columns**; company
**Submissions**, stats and activity on proof_uploads; public **`/recruiter/:linkId`** and **`/portfolio/:slug`**
projects.

## C. Old architecture reachable but should be replaced (not just deleted)

StudentUploadsPage (keep the voice card), useAllStudentTasks status derivation, StudentRoadmapPage
stage state, StudentPortfolioPage + public Portfolio, college notifications, admin Overview /
Analytics / People / Task Oversight numbers, Trust & XP → XP-only tool, company Submissions /
stats / activity, `transcription-enqueue` proof_id + DB guard branch, DB functions that still
count proof_uploads or trust_score.

## D. Truly dead code safe to delete (no route, no import, no dynamic import, no server caller)

22 orphan files (§5 "Shared / other orphans" + college/recruiter/public orphans), `pages/ProofViewer.tsx`
(lazy import without a route), `UploadProofModal.tsx`, and the unreachable upload/quiz branches
inside `StudentAssignedTasksPage.tsx` (+ `ConceptualQuestionsModal`, `useConceptualTests` once those
branches go).

## E. Backend functions safe to delete only after the UI is replaced

verify-proof, github-check, ai-authorship, trust-compute, question-generator, response-evaluator,
submit-conceptual-answers (after Proof Review and the quiz code go); proof-file-url (after Entries,
Portfolio, company Submissions, RecruiterView are replaced); leetcode-streak-sync (after CodingStreaks);
legacy RPCs cosign_proof, cosignable_proofs, my_cosigns, set_proof_publicity. Update
`functions-service` SLUGS, `/ready` expected count (40 → 31), `authz_test.ts`, `attack_surface_check.py`
and docs in the same change.

## F. Database / schema / data that must remain until the final cleanup

All legacy tables (0 rows, but referenced by triggers, FKs and current functions), the
student_profiles.trust_score column, the legacy triggers, and the compatibility branches inside current
functions (§5 Database). The FK from proof_uploads/task_assignments to tasks currently blocks company
task deletion (comment in StartupViewTasksPage) — keep in mind when dropping.

## G. Exact proposed cleanup order

1. **Decide the 2 open questions:** GitHub/LinkedIn links (drop, or move to Profile → Settings,
   since recruiters see them) and `/recruiter/:linkId` (remove the route, or rebuild share links).
2. **Step 1 — delete dead code (D):** orphans, ProofViewer, UploadProofModal, the unreachable
   branches. Frontend only; build + unit tests + browser check; no behaviour change.
3. **Step 2 — remove old UI (REMOVE_UI_NOW):** Proof Review menu + `/review-proofs`, Trust Score
   (student, college, filters), Cosigns tab, LeetCode/HackerRank box, Privacy proof section.
4. **Step 3 — replace mixed screens (REPLACE_BEFORE_REMOVE, frontend):** Entries (voice card only +
   submissions), task status and roadmap from task_submissions, Portfolio from passed work, admin
   stats/charts/columns/Task Oversight, Trust & XP → XP-only, company Submissions/stats/activity.
   Each staging-tested, then live with approval.
5. **Step 4 — server:** remove the 9 legacy functions from SLUGS and the repo; update `/ready`
   expected count, tests, attack-surface list, docs; deploy staging → production.
6. **Step 5 — database code:** migration rewriting the current functions without proof_uploads /
   trust_score (incl. the voice guard and transcription-enqueue proof_id), drop legacy RPCs and
   triggers. Staging rehearsal with ROLLBACK, backup, then production.
7. **Step 6 — data/schema (final):** after a quiet period, backup, then drop the legacy tables and
   the trust_score column; regenerate `types.ts`.
