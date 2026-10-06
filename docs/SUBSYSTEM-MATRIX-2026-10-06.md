# Subsystem matrix — 6 Oct 2026 (staging, work/stabilization)

Status words: **COMPLETE** (reachable, wired, authorized, failure state, and tested end to end) · **PARTIAL** (works, but a named
part is untested or missing) · **BROKEN** · **DEFERRED** · **NOT PRESENT**. Nothing is COMPLETE because a file exists.

## Evidence keys (all staging, 6 Oct 2026 unless noted; raw output in `e2e-out/`)

| Key | What ran | Result |
|---|---|---|
| BJ | `staging_browser_e2e.mjs` role journeys (content assertions) | 31/31 |
| SJ | `e2e-out/sprint/sprint_e2e.mjs` sprint journeys | 9/9 |
| SW | `staging_screen_walk.mjs`: every screen of every role opened, no crash / console error / failed request | 60/61 (the 61st = admin notifications, legitimately empty) |
| SC | `staging_scale_check.py --jobs` screen queries + nightly jobs on 15,000 students | 26/26 |
| FA | cross-account sweep of all functions | 75/75 |
| RA / D4 | database permissions / behaviour (cross-tenant) | 27/27 · 12/12 |
| F1 / SUS / ID | only the bridge signs / suspended + old ticket refused / service identities | 34/34 · 23/23 · 28/28 |
| IMP / EV | student import all-or-nothing / evaluator type integrity | 7/7 · 10/10 |
| VB | voice evidence binding + immutability | 14/14 |
| DL | Daily Lots release target, exactly 2,000 students | 16/16 |
| CA | coding audit (Run vs Submit, hidden tests) — release freeze, same backend image | 43/43, leaks 0, run-vs-submit 12/12 |
| WA | written/rubric audit — release freeze (paid AI) | as recorded then |
| VC / VS | voice paid cases / voice storm — release freeze | **15/16** / 6/6 |
| SS / RF | submit storm / reaper fixture — release freeze | 5/5 / 3/3 |
| DG | admin task-delete guard browser check | 5/5 |
| OUT | `record_outcome` API: company moves a stage and back (200, row checked); student refused ("not a recruiter") | 2/2 |
| BF | bug-finder plumbing run (release gate) | see gate |
| LD | mixed load 100–300 (4 Oct report) | clean to 250; 300 request-clean, coding latency degraded |

## Student

| Feature | Status | UI | Backend | Auth | Failure state | Evidence | Remaining risk |
|---|---|---|---|---|---|---|---|
| Sign-in / onboarding / intake | PARTIAL | yes | yes | F1, SUS | yes | BJ (fresh student lands on intake), SW | Real Google sign-in not exercised on staging (shared Identity pool); profile-overwrite bug fixed today (`f3517a8`) |
| Profile / settings / privacy | COMPLETE | yes | yes | RA | yes | BJ, SW, D4 | Privacy lists every recording with no paging (291 on a test account); portfolio link text fixed today (showed a dead `/p/` address) |
| Daily Lots | COMPLETE (2,000) | yes | yes | ID (Scheduler identity) | partial_failure / failure / retry | DL, SC, BJ | 15,000 exceeds production's 3 tries (advisory); threshold between 2,000 and 15,000 not measured |
| Coding Run + Submit | COMPLETE | yes | yes | FA, runner IAM (ID) | busy / timeout messages | CA, SS, LD | Coding latency degrades at 300 concurrent |
| Written / rubric work | COMPLETE | yes | yes | FA | 503 when AI fails, nothing stored | WA, EV | Paid AI; not re-run this pass |
| Voice | **PARTIAL — FINAL LIVE PAID RETRY PENDING** | yes | yes | VB, FA | failed / no score; reaper | VC 15/16, VS 6/6, VB 14/14, RF 3/3 | The failed paid case received retry changes afterwards; a paid post-fix run has NOT been done. Enqueue has no per-student rate limit (queue caps concurrency at 2, so one student can delay others) |
| Proof / evidence (Build-log) | COMPLETE | yes | yes | RA, VB | yes | BJ, SJ (6 of 6 matches the database) | — |
| Portfolio (public) | COMPLETE | yes | yes | RA (opt-in) | not-found page | BJ, SW | — |
| Squads | COMPLETE | yes | yes | D4 | yes | BJ, SC, SW | — |
| Notifications | PARTIAL | header bell | yes | RA | yes | SW (screens open) | No content assertion; `StudentNotificationsPage` is imported but unused (the tab maps to Profile) |
| Resume / readiness | PARTIAL | yes | yes | FA | 503 on AI failure | SJ (readiness score parts), SW | Resume parsing / retest are paid AI, not re-run this pass |
| Roadmap / tracks | COMPLETE | yes | yes | FA | yes | SJ (course link), SW | — |

## TPO (college)

| Feature | Status | UI | Backend | Auth | Failure state | Evidence | Remaining risk |
|---|---|---|---|---|---|---|---|
| Dashboard (home, attention list) | COMPLETE | yes | yes | RA, D4 | yes | BJ, SC, SW | — |
| Student drill-down | COMPLETE | yes | yes | D4 (cross-college refused) | yes | BJ, SJ, SC | — |
| Readiness | PARTIAL | per-student only | yes | D4 | yes | SJ | No college-wide readiness view |
| Interventions | NOT PRESENT | shown only if rows exist | table only | — | — | 0 rows on staging; nothing in the code creates one | Not advertised (section hidden when empty) |
| Cohorts / branch views | COMPLETE | branch filter | yes | D4 | yes | SC (search, filters), SW | — |
| Reports / analytics (Insights) | COMPLETE | yes | `tpo_insights` | RA (approved colleges only, migration 49) | yes | BJ (survives refresh), SW | — |
| Student import | COMPLETE | yes | yes | FA | all-or-nothing | IMP | — |
| Student removal | COMPLETE (hardened today) | yes | accounts + `remove_students()` | see removal section | yes | code + DB review | Irreversible; now needs the typed word REMOVE |

## Company / recruiter

| Feature | Status | UI | Backend | Auth | Failure state | Evidence | Remaining risk |
|---|---|---|---|---|---|---|---|
| Dashboard | COMPLETE | yes | `recruiter_home` | RA | yes | BJ, SC, SW | — |
| Lots / challenges (create, sponsor) | COMPLETE | yes | `company-lot` | FA, D4 (pending recruiter refused) | yes | BJ, SW | — |
| Submissions + reviews | COMPLETE | yes | `company_submissions`, `company_review_submission` | D4 | yes | BJ, SC | — |
| Student discovery (Talent) | COMPLETE | yes | `recruiter_talent` | RA | yes | BJ, SC | — |
| Shortlist | COMPLETE | yes | yes | D4 | yes | BJ | — |
| Outcomes (stage) | COMPLETE | stage select | `record_outcome` | D4 + OUT | error toast | OUT | — |
| Settings | PARTIAL | yes | yes | RA | yes | SW only | No content/save assertion |

## Admin

| Feature | Status | UI | Backend | Auth | Failure state | Evidence | Remaining risk |
|---|---|---|---|---|---|---|---|
| Dashboard / reports / announcements | PARTIAL | yes | yes | RA | yes | BJ (home), SW | Announcements and reports opened only (SW) |
| Student Trace | COMPLETE | yes | `admin_trace_*` | admin-only RPCs (RA) | yes | SW (timeline with real step counts) | Low: its three inner views are buttons, not in the address, so a refresh returns to the timeline |
| Bug Finder | COMPLETE | yes | Cloud Run job | admin-only RPCs | records failed steps | BF, SW | — |
| Work / Daily Lots | COMPLETE | yes | yes | RA | yes | SJ (provenance, why, score parts), SW | — |
| Task oversight | COMPLETE (fixed today) | yes | yes | RA | error state | DG, SW | Fixed today: delete guard; ~2,500 requests per page open → batched; status filter matched no rows (case) |
| Student management (oversight, suspend, remove) | COMPLETE | yes | yes | RA, SUS | yes | SW, SUS | Remove now needs the typed word REMOVE |
| Notifications | PARTIAL | yes | yes | RA | empty state | SW (empty) | No notification content to verify |
| Security / diagnostics (AI usage, Jobs & health, Security & audit) | COMPLETE | yes | yes | RA | yes | BJ, SW | — |

## Platform

| Area | Status | Evidence | Remaining risk |
|---|---|---|---|
| Auth (bridge-signed tickets, suspension) | COMPLETE | F1 34/34, SUS 23/23 | Real Google sign-in not exercised on staging |
| RLS / grants / SECURITY DEFINER | COMPLETE | RA 27/27, D4 12/12, FA 75/75 | — |
| API / functions | COMPLETE | `/ready` 32/32, FA, server function tests 112/112 | — |
| Files | COMPLETE | files tests 16/16, VB | — |
| Voice pipeline | PARTIAL | VB, VS, RF; VC 15/16 | Paid post-fix retry pending; no per-student enqueue limit |
| Code runner | COMPLETE | ID 28/28 (private, IAM), CA 43/43 | Dedicated runner is staging-only until rollout Stage 3.1 |
| Scheduled jobs | COMPLETE (2,000) | SC 26/26, DL 16/16, ID | Daily Lots at 15,000 exceeds the retry budget (advisory) |
| Rate limiting | PARTIAL | `guard()` on run-code, run-sandbox, submit-*, resume-code-execute, client-log; all AI calls limited centrally in `generateText` | Fails open by design (alerts); `transcription-enqueue` has no per-user limit |
| Retries | COMPLETE | runner busy-retry, LLM retry, Scheduler retryCount 2, Cloud Tasks maxAttempts 3 | — |
| Logging | COMPLETE | request-id tracing, scrubbed JSON logs | — |
| Recovery | PARTIAL | reaper RF 3/3, rollback documented in the checklist | Disaster restore rehearsed for migrations only |
| Destructive delete paths | PARTIAL (hardened today) | task delete guard (DG); student removal typed confirmation | Removal record is partial and has no restore tool (see below) |

## Student removal (`remove_students`) — verified 6 Oct 2026

- **Who can call it:** only `service_role`; `anon` and `authenticated` cannot execute it. It is reached only through the accounts service's `/remove`, which needs a valid bridge ticket and the role `admin` or `college_admin`. Inside, a college may remove only its own students (`that student belongs to another college`). `_reason` must be `college`, `admin` or `console_sync`; only the console sync may act without a person, and the sync itself only SUSPENDS.
- **What is deleted:** `account_identities`, `student_intake`, the `auth.users` row; that cascades to `student_profiles` and from there to about 30 tables: tasks, task_submissions (and submission_reviews), task_assignments, voice_explanations, xp_logs, student_levels, student_tracks, student_skills, student_badges, student_certifications, student_credits, student_streaks, student_weekly_scores, student_week_plan, student_quests, student_portfolios, student_interests, resume_claims, resume_assessments, resume_scorecards, mock_interviews, interventions, recruiter_shortlists, recruiter_views, squad_members, topic_ratings, manual_adjustment_log, app_events, student_activity_events, account_sync_missing, notifications, user_roles, user_preferences. Then the Google login is deleted.
- **What the record keeps** (`removed_students.snapshot`): profile, contact, provider uid, squad membership, tasks, submissions, resume scorecards, tracks, levels, voice rows. **Not kept:** XP history, badges, weekly scores, streaks, resume claims and assessments, mock interviews, interventions, shortlists, assignments, reviews, notifications. Recording audio files are not part of it.
- **Restoration:** no restore function or runbook exists, and the Google login is deleted. A restore would be manual and partial. **Removal is therefore treated as irreversible.**
- **Accidental use:** before today, one OK click (up to 500 students at once) whose text said "A backup is kept". Now both screens (admin Student oversight, TPO Students) ask the person to type `REMOVE`, say it cannot be undone, and point to Suspend instead.
- **Not changed today** (needs a migration, which would invalidate the 43/43 rehearsal): widening the snapshot, or a restore function.
