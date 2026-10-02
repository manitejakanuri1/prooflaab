# ProofLabAI — final pin-to-pin full project dossier (3 Oct 2026)

**Read-only discovery.**
- No application source, staging, production, database, IAM, scheduler, queue, secret or test account was changed.
- The only files created are discovery documents under `docs/` (uncommitted) and the evidence ZIP outside the repository.

**Evidence tags:**
- **SRC**: source at HEAD.
- **CFG**: live cloud configuration read on 3 Oct.
- **DATA**: production row counts and aggregates read on 3 Oct, GET only, no personal data printed.
- **RUN**: tested on 3 Oct.
- **EARLIER**: tested 29 Sep–2 Oct, not re-run.
- **DOC**: documentation only.
- **INFERRED** / **UNKNOWN**.

## 0. Executive summary

**What ProofLabAI is today.** A working pilot on Google Cloud with 17 students, 2 colleges and 3 companies.

Sound foundations:
- crawler → `source_content` → **one AI Lot template per page, reused by all students**;
- execution-validated coding tests for Daily Lots;
- quote-checked rubric grading;
- a robust async voice pipeline (Cloud Tasks, leases, reaper);
- per-service robots with no Editor role;
- backups with a tested restore.

**What changed today.** This discovery materially changed the earlier understanding:
1. **F3 root cause found.** Rate limiting, AI usage logging, the AI cache and server security events read `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` directly, not through `backend.ts`. Production has neither variable, so all four have been silent since the 12 Sep move to Google (last `llm_usage` row 11 Sep; 0 server security events ever).
2. **N20 (new, P1 candidate).** Resume MCQ answer keys and hidden coding tests are stored on `resume_assessments`, a row the student can read and, by policy, UPDATE through PostgREST (`FOR ALL own`; `id = user_id` 17/17). Live exploitability is NOT TESTED.
3. **The resume coding round is weaker than the Daily Lot engine.** Its 3 AI tests per problem are never validated, are returned to the browser after Submit, are shared across students with the same skill profile, and TypeScript is mapped but cannot run.
4. **Production currently hands out no coding Lots.** All 14 submissions are written (`runner=llm`). 0 of 83 tasks have a sandbox config; 72 of the 83 are resume-roadmap tasks on the generic checklist.
5. **The crawler corpus is static and small.** 28 pages; nothing new since 13 Sep; job grounding never used (0 `job_opportunities`); `grading_mode_hint` NULL everywhere, so a keyword regex decides coding vs written. agent-reach is a tool installer (`gh`, `yt-dlp`), not a research agent; web pages go through Jina Reader.
6. **Lot wording is defective in identifiable ways.** "Submit a plain text file" (no upload exists), "use the attached article" (not shown), fabricated first-person premises, voice folded into written tasks, and a coding test set that a constant-output program passes.
7. **Sponsored Lots are broken the same way as company Submissions** (N24). Results land in `task_submissions` but the recruiter reads `proof_uploads`. The work is graded by the generic written checklist.
8. **Ops findings.** The deep bug-finder trigger is failing (code 7 PERMISSION_DENIED). `accounts /password-link` hands a reset link for any email to any webhook-secret holder. Leftovers: a staging job, queue and test worker. Staging shares the production DeepSeek key.

**Counts after revalidation:**

| Severity | Count |
|---|---|
| P0 | 0 |
| P1 | 7 |
| P2 | 19 |
| P3 | 20 |
| P4 | 10 |
| UNKNOWN | 11 + register below |

Detail: `SECURITY-F1-F21-REVALIDATION-2026-10-03.md`.

**Overall: READY FOR STABILISATION IMPLEMENTATION**, starting with Waves 0–1 of `FINAL-IMPLEMENTATION-DEPENDENCY-PLAN-2026-10-03.md`. **Not ready for broader rollout.**

## 1. Verified baseline (SRC, CFG)

| Item | Value |
|---|---|
| Repository | `C:\Users\manit\Downloads\prooflabai-mvp\prooflabai-mvp`; remote `prooflaab` = github.com/manitejakanuri1/prooflaab (no `origin`) |
| Branch / HEAD | `work/step6j-release-gates` @ `d736e4dd95925aeaa017200d06033bf0d92c77fa` |
| GitHub main / work branch | both `d736e4d` (`ls-remote`) |
| Local `main` ref | stale at `28578fa` (26 Sep, 79 behind); never used for pushes. **Difference recorded; no code impact** |
| Staged / unstaged tracked changes | none |
| Untracked | 7 old STEP6 audit files, `authz_matrix_results.json`, `__pycache__`, `voice-playback-fail.png`, the 2 Oct legacy audit, the 12 reports of 3 Oct, and the 19 reports + living architecture file of this discovery |
| Live website | `index-DOGmJNPd.js` = `d736e4d` |
| Live revisions | see `CURRENT-FULL-SYSTEM-ARCHITECTURE` §2 |

## 2. Product intent (owner, as given)

| Role | Intended |
|---|---|
| Student | Floor · Build-log · Squad · Profile. Lot → understand → do the work → submit → authoritative evaluation → **required voice** → async processing → Build-log. No conceptual quiz after submit; not an LMS |
| TPO | Home · Students · Squads · Insights: participation, readiness, weak/inactive, improvement, squads, interventions. No Trust Score |
| Recruiter (organisation = Company) | Home → Talent → Shortlist → Lots → Submissions → Review → hiring decision. **One role, not two platforms** |
| Admin | Users, colleges, recruiters, tasks/submissions, flagged, operations, jobs, health, current evidence. Not Upload Proof / Trust / Cosigns / old review |
| Retired | Trust Score (+ history), Upload Proof / `proof_uploads`, conceptual verification, Cosigns, old Proof Review, LeetCode/HackerRank/old GitHub scoring, old recruiter proof viewer, old company proof submissions, old public proof, appeals/reflections, proof stats/notifications |

## 3. Architecture: current, target and gap, per subsystem

Detail docs: `CURRENT-FULL-SYSTEM-ARCHITECTURE`, `TARGET-SYSTEM-ARCHITECTURE`.

| Subsystem | A. Current reality | B. Intent | C. Gap |
|---|---|---|---|
| Frontend | 27 routes. The student shell has 4 nav items but **about 22 visible concepts / 17 sub-tabs** (SRC) | 4 simple areas | Concept overload; legacy tabs (Cosigns, Progress streaks, Privacy proof, Portfolio) |
| Backend | 40 slugs in one Deno service; 9 legacy; all `service_role` (SRC, CFG) | least privilege | F2; legacy slugs public |
| Database | 92 exposed tables/views; 12 empty legacy tables; two migration folders (DATA, SRC) | one schema source | F17; legacy objects; N20 policy |
| Auth | Identity → bridge HS256 → RLS / hand-checks; one shared secret (SRC, CFG) | single signer, verified email | F1, F4, F5 |
| Crawler | seed-only weekly job, Jina for web, agent-reach tools for GitHub/YouTube; 28 pages, static since 13 Sep (SRC, CFG, DATA) | research agent grounding Lots in real pages + jobs | corpus size, no discovery, no jobs, unused hint |
| Lot generation | first student's browser triggers lot-writer; template reused by all; up to 7 AI calls per page (SRC) | grounded, clear, pre-generated | browser-triggered; no wording contract |
| Question quality | defects in real samples (DATA) | Title/Context/Task/Input/Output/Constraints/Example | see `QUESTION-WORDING…` |
| Resume | parser → claims → 5 MCQ + short → coding 2×3 tests → scorecard → roadmap tasks (SRC) | verified claims | N20, unvalidated tests, leaked hidden tests |
| Assessment | MCQ server key; short answers AI (cached); server timer (SRC) | deterministic where possible | key storage (N20) |
| Coding | Daily: validated tests + redact; resume: unvalidated + no redact; no coding Lots live now (SRC, DATA) | one execution engine | duplication, test quality (N23) |
| AutoTestCase | AI-simulated pass/fail; no licence (external SRC) | backend-only concepts | adopt concepts only; never simulation |
| Code runner | 8 languages, 6 × 1, public fallbacks (SRC, CFG) | isolated, internal, no fallbacks | F8, F9, F10, N10, no tests |
| Written grading | quote-checked rubric, second grader near the line, trigram similarity (SRC) | authoritative | resubmits unlimited; generic checklist for many tasks |
| Voice | async server path solid; optional, unlimited, not content-linked; browser path still scoreable (SRC, DATA) | required after submit, async | N4, N5, F11, F12 |
| Build-log | Entries = voice + submissions + conceptual (+ realtime on legacy) (SRC) | current work only | legacy sources |
| TPO | Home/Students/Squads/Insights live; trust field; import (SRC, EARLIER) | same, no trust | trust remnants; F4 at import |
| Recruiter/Company | role startup; `startups` + `recruiters`; two Work systems; Submissions and Sponsored Lots broken (SRC) | one role/org, task_submissions | L1, N24 |
| Admin | mixed: Proof Review, Trust & XP legacy; Token Usage blind (SRC) | current ops | L2; F3 |
| Squads | nightly formation, weekly seasons; names hidden (N3); `form_squads` reads `trust_score` (SRC) | squads on current scores | L7, N3 |
| AI / DeepSeek | 23 call sites (19 current), 1 async, no timeouts, no metering (SRC, CFG) | hybrid sync/async, metered | F3, F14, F15 |
| Scheduled jobs | 12 prod + 1 staging, all IST; deep bug-finder failing (CFG) | reliable | N26 |
| Cloud | 8 prod + 9 staging services, 3 jobs, 3 queues; scale-to-zero; console-managed (CFG) | IaC | F18; leftovers |
| Storage | private/public/backups; no lifecycle; orphans (CFG) | retention rules | N2, F11 |
| IAM | per-service robots, no Editor; compute SA reads all secrets (CFG) | least privilege | N14, F1 |
| Migrations | 66 + 139 files, highest 49, no applied table (SRC) | one source | F17, N11 |
| CI/CD | website only, rebuilt after tests; backends manual (SRC) | build-once | F16 |
| Monitoring | 27 alerts, 8 uptime; blind to AI usage, removals, crawler 0-new, trigger failures (CFG) | full coverage | gaps |
| Backups | daily + PITR + tested restore (CFG, EARLIER) | — | Identity logins not recoverable |
| Testing | unit/typecheck/partial Deno in CI; no runner tests; healthcheck/authz blocked by N1 (SRC) | gates | §Testing doc |
| Performance | staging ≤ 200 browse; 16 DB connections; single daily job (CFG, EARLIER) | 15k registered | not demonstrated |
| Cost | DeepSeek unmeasured since 11 Sep; ₹3,000 budget alert (DATA, CFG) | visible per feature | F3 |
| Legacy | about 64 components; 30 removable now (SRC) | retired | §Legacy doc |

## 4. End-to-end journeys (current)

### 4.1 Student (point 129)

| Step | Component / function / table | Notes |
|---|---|---|
| Imported | TPO `TpoImportStudents` → `create-student-users` → Identity `accounts:signUp` → `record_account` → student_profiles / contact / intake / user_roles; `send-onboarding-email` (Resend) | F4 link without verification; F19 not transactional |
| Invite / login | email → `/auth` → Identity → bridge `/token` | browser verified-email gate |
| Intake | `/student/start` → `IntakeChoice` | — |
| Resume or skip | `resume-parser` → resume_claims; or `interests-analyze` → student_interests | full resume to DeepSeek |
| Claims | `ResumeCheckFlow` confirm/edit | free edits |
| Assessment | `resume-question-generator` → resume_assessments → `TimedResumeAssessment` → `resume-assessment-submit` | N20 |
| Coding round | `resume-coding-generate` (ai_templates) → `resume-code-execute` | unvalidated, leaked tests |
| Scorecard | resume_scorecards (+ roadmap tasks: 72 rows) | — |
| Dashboard | `/student/dashboard`: Daily Card | 17 sub-tabs |
| Daily Lot | 05:40 IST `assign_todays_lots` → `create_lot_for` → tasks; `lot-writer` on first open | same page order for all |
| Submission | `WrittenTaskPanel` → `submit-written-task`, or `SandboxTaskPanel` → `submit-sandbox-task` → `record_task_submission` → task_submissions, xp | all 14 are written |
| Voice | `VoiceExplainModal` → files → `transcription-enqueue` → Tasks → worker → transcriber → `voice-score` | optional, unlimited |
| Build-log | `StudentUploadsPage` etc. | mixed legacy |
| Squad | `StudentSquadPage` ← nightly `form_all_colleges`, weekly `run_all_seasons` | names "—" |

### 4.2 TPO (point 130)
1. College setup: onboarding → `colleges.verification_status` → admin approves (`CollegeOversight`).
2. Import: `TpoImportStudents` → `create-student-users` → invitations by email. Squads form automatically (nightly, and at import per CLAUDE.md DOC).
3. Activity: `TpoHome` and `TpoStudents` (`tpo_students`, which reads trust_score).
4. Squads: `TpoSquads` (scoring rules, naming themes, cohorts).
5. Insights: `TpoInsights` (`tpo_placement_report`, approved-only since migration 49).
6. Intervention: `interventions` (3 rows), `REMINDER_SENT` audit rows (DATA).
7. Material: TPO can post JDs (`job_opportunities`; none yet) and source material (`college_submit_source_content`, 1 page).

Status: works (EARLIER 2 Oct), with trust remnants.

### 4.3 Recruiter / Company (point 131)
1. Signup (`OnboardingStartup`, role `startup`) → verification → Home (`recruiter_home` + startup stats on **proof_uploads**).
2. Talent (`recruiter_talent`, `ProofProfile`, `recruiter_log_view`) → Shortlist (`recruiter_shortlist`).
3. Sponsor a Lot (`sponsor_lot` → tasks `sponsored_by` = recruiters id; **generic checklist**).
4. The student does it → task_submissions.
5. **Recruiter Lots view reads `proof_uploads`, so the result is never seen** (N24).
6. In parallel, Post Task → Applications → Submissions (**proof_uploads**, L1): broken.
7. Outcome: `record_outcome` (saved … hired) works.

### 4.4 Admin (point 132)

| Usable modern | Legacy |
|---|---|
| People (students, companies, colleges, oversight/creation) | Proof Review (+ 5 legacy functions) |
| Task Oversight | Trust & XP |
| Assign Tasks | `/review-proofs` |
| Content Library | Overview/Analytics stats partly on proofs |
| Student Trace | — |
| Bug Finder | — |
| Security Events (client only) | — |
| Settings | — |
| Flagged | — |
| Token Usage | **blind since 11 Sep** |

## 5. Squads / seasons (point 59, SRC + CFG)

The chain runs: college students (active, by section/cohort) → nightly `form_all_colleges` / `form_squads` (balances by `trust_score`: L7) → squads (max about 11) + reserves (`tpo_reserves`) → `extend_all_fixtures` (round robin) → Sunday `run_all_seasons` (`run_squad_week`, `settle_round`, `qualify_squads`, `generate_knockout` / `final` / `championship`) → `squad_weekly_scores` / `student_weekly_scores` (0 rows yet) → leaderboard → champion (`seasons.champion_squad_id`).

Scoring inputs come from `squad_scoring_rules` (7) on current activity. Name visibility bug: N3.

## 6. Good architecture: keep (point 133, with evidence)

| Item | Evidence |
|---|---|
| Lot template reuse: one generation per page, reused by all | SRC `lot-writer`, unique `source_content_id`; DATA 37 templates for 83 tasks |
| Execution-validated grading config for Daily Lots (reference solution must pass every test) | SRC `auto-config` |
| Hidden-test redaction and admin-only grading-config tables | SRC `redact`, RLS stage69/70 |
| Quote-checked rubric grading with a conservative second grader | SRC `rubric-grading`, `submit-written-task` |
| Async voice: idempotent enqueue, fenced leases, reaper, private OIDC worker | SRC, CFG, EARLIER |
| Separate code runner, concurrency 1, own-runner-only `run-code` | SRC, CFG |
| One AI helper (single choke point, easy to fix F3/F14) | SRC |
| Shared resume/skip path (one code path, two inputs) | SRC |
| Per-service robots, no Editor | CFG |
| Backups + PITR + tested restore; rollback scripts rehearsed | CFG, EARLIER |
| Structured logging with request ids; step trail; 27 alerts | SRC, CFG |
| Crawler politeness: robots, rate limits, canonical URL dedupe, simhash | SRC |
| Idempotent daily Lot creation (unique `student_id`, `lot_date`) | SRC |

## 7. Broken flows (point 134)

| Flow | Tag |
|---|---|
| Company Post Task → Submissions (L1) | SRC |
| Recruiter Sponsored Lot → result visible (N24) | SRC |
| Bug finder light and deep; healthcheck; authz matrix full run (N1, N26) | CFG, EARLIER |
| Coding Lots not reaching students right now (0 sandbox tasks) | DATA |
| Admin Token Usage / cost view (F3) | DATA |
| Lot text with impossible deliverables or unseen references (N30) | DATA |
| Squad teammate names (N3) | SRC |

## 8. Risky (works today, unsafe at scale) (point 135)

F1, F2, F4, F6, F7 + N25, F8, F9, F10, F11, F12, F14 (no timeouts), F16, F17, F18, F19, N20, N21, N22, N23, N27, N28, the single daily job (F21), 16 DB connections, recruiter search (U6).

## 9. Waste (point 136)

See `LEGACY-DUPLICATE-WASTE-DEPENDENCY-MAP` §4:
- 9 legacy slugs;
- 30 dead files;
- legacy realtime subscriptions;
- staging leftovers (job, queue, test worker);
- `interview-scraper/`;
- orphan secrets;
- dormant Gemini/Kimi paths;
- unused crawler toolchain parts;
- 12 empty tables;
- storage orphans;
- rubric-config orphans.

## 10. Expensive (point 137)

- Unlimited written resubmits (1–2 AI calls each).
- No working per-user AI cap (F3).
- No AI timeouts.
- The resume roadmap computed synchronously.
- lot-writer worst case of 7 calls per page.
- Per-student resume question generation (by design).
- Two always-on Cloud SQL instances.

Lots are **not** generated per student.

## 11. Missing (genuine, not retired) (point 138)

1. Required, content-linked voice step.
2. Recruiter submissions/review on current data.
3. Current admin review queue.
4. A test-quality validator and a wording validator.
5. Lot pre-generation.
6. Job-source ingestion.
7. Code-runner tests and isolation.
8. AI timeouts and metering.
9. A delete ceiling on sync.
10. An applied-migrations table.
11. IaC.
12. CI for backends.
13. A production capacity measurement.
14. Language-accuracy measurement for Whisper.
15. Identity login recovery.

## 12. Contradictions: current reality vs documentation (point 121)

| # | Document says | Reality |
|---|---|---|
| C-1 | CLAUDE.md: each student "explains it out loud for 60 seconds" | voice is optional and unlimited (N4) |
| C-2 | CLAUDE.md: "No upload proof" | upload/proof code paths remain (D5), though the student modal is unreachable |
| C-3 | CLAUDE.md: Company = "Startup and Recruiter merged" | two org entities (`startups`, `recruiters`) and two Work systems |
| C-4 | `crawler/README.md`: weekly via `.github/workflows/crawl.yml` | Cloud Run job + Scheduler; the workflow is manual-only |
| C-5 | `crawl.yml` header: secrets `SUPABASE_URL` / `SERVICE_ROLE_KEY` | body uses `PGRST_JWT_SECRET` |
| C-6 | `_shared/llm.ts` header: Gemini required for resume-parser PDFs / resume-voice-verify | parser is text-only; resume-voice-verify is not registered; no Gemini key in production |
| C-7 | `_shared/rate-limit.ts`: "the AI spend cap in student_credits is the backstop" | `student_credits` has 0 rows; no backstop |
| C-8 | CLAUDE.md: live bundle `index-CWe_5Kb3.js`, functions `00052-g84` | `index-DOGmJNPd.js`, `00053-c7m` |
| C-9 | CLAUDE.md: test logins = smoke student | deleted (N1) |
| C-10 | CLAUDE.md: auth-bridge/files "older image with no /ready" | bridge redeployed (`00012-vdh`); files still `v-no-vercel` |
| C-11 | `docs/PRODUCTION-ARCHITECTURE.md` lists the default compute SA / old revisions | per-service robots since G05 (D4) |
| C-12 | PDR "migrations 43–54 / 66 files" | highest 49; 66 + 139 files (D1); PDR file absent (N18) |
| C-13 | `_shared/serve.ts` / `backend.ts` comments: "41 functions" | 40 slugs |
| C-14 | resume question prompt: "15-second timer" | 30 s MCQ / 90 s written |
| C-15 | CLAUDE.md bug-finder notes: "3x/day", "every 6 hours" (older sections) | `0 6,10,14,18,22` + deep 04:00 (later section correct) |
| C-16 | Seed Lot text promises "record sixty seconds" | no required recording |
| C-17 | Lot prompt rule: material referred to "below/attached" must be in `code_sample` | real Lots reference an unseen "attached PrepInsta article" |
| C-18 | `scheduled-job` header: "these six ran inside the database" | the JOBS map has 7 |

## 13. Unknown register (point 139)

| ID | Unknown | Why | Safe evidence that settles it |
|---|---|---|---|
| U1 | Applied-migrations table in production? | no repo record | read-only SQL owner job (`information_schema.tables`) |
| U2 | Runner egress / metadata reachable in practice | not probed | staging probe |
| U3 | F8 exploit in practice | not probed | staging forking test |
| U4 | Identity Platform settings (enumeration protection, password policy, email verification enforcement) | console only | console read |
| U5 | Real monthly bill per service | no billing read | billing export |
| U6 | Recruiter search at 1k / 10k / 15k | not measured | staging seed + Query Insights |
| U7 | Contents of the single `proofs/` object | personal-data caution | owner look |
| U8 | Full production RLS / grant inventory | needs SQL | read-only SQL owner job |
| U9 | Legal status of DeepSeek transfer and source usage | legal | legal review |
| U10 | **N20 exploitable live?** (column grants on `resume_assessments`) | not probed | staging GET/PATCH as a test student; production grants via read-only SQL |
| U11 | Exact cause of the deep-run code 7 | IAM not read for `run.jobs.runWithOverrides` | read `rt-scheduler` grants on the job |
| U12 | Whisper accuracy for Indian English / Telugu-English | never measured | labelled sample set on staging |
| U13 | Jina Reader terms / limits | external | read terms |
| U14 | `notify_weekly_progress` idempotency in production (migration 40 status) | not verified | read-only SQL |
| U15 | Real AI spend 12 Sep → today | logging off | DeepSeek console usage |

## 14. Implementation dependencies and release gates

- Dependency order: `FINAL-IMPLEMENTATION-DEPENDENCY-PLAN-2026-10-03.md`, Waves 0–12 with parallel streams.
- Gates: `TESTING-OBSERVABILITY-RELEASE-EVIDENCE-MAP-2026-10-03.md` §7.

## 15. Companion reports (this discovery)

1. `CURRENT-FULL-SYSTEM-ARCHITECTURE-2026-10-03.md`
2. `TARGET-SYSTEM-ARCHITECTURE-2026-10-03.md`
3. `COMPLETE-FRONTEND-ROUTE-AND-SCREEN-MAP-2026-10-03.md`
4. `COMPLETE-BACKEND-FUNCTION-AND-SERVICE-MAP-2026-10-03.md`
5. `COMPLETE-DATABASE-DATA-MODEL-2026-10-03.md`
6. `CRAWLER-AGENT-SOURCE-TO-LOT-TRACE-2026-10-03.md`
7. `RESUME-ASSESSMENT-CODING-SYSTEM-TRACE-2026-10-03.md`
8. `CODING-EVALUATION-AND-AUTOTESTCASE-GAP-ANALYSIS-2026-10-03.md`
9. `VOICE-COMPLETE-PIPELINE-TRACE-2026-10-03.md`
10. `DEEPSEEK-AI-CALL-INVENTORY-2026-10-03.md`
11. `SYNC-ASYNC-JOB-QUEUE-MATRIX-2026-10-03.md`
12. `AUTH-IDENTITY-AUTHORIZATION-MAP-2026-10-03.md`
13. `LEGACY-DUPLICATE-WASTE-DEPENDENCY-MAP-2026-10-03.md`
14. `SECURITY-F1-F21-REVALIDATION-2026-10-03.md`
15. `CLOUD-INFRA-IAM-COST-CAPACITY-MAP-2026-10-03.md`
16. `TESTING-OBSERVABILITY-RELEASE-EVIDENCE-MAP-2026-10-03.md`
17. `QUESTION-WORDING-AND-EVALUATION-QUALITY-AUDIT-2026-10-03.md`
18. `FINAL-IMPLEMENTATION-DEPENDENCY-PLAN-2026-10-03.md`

Plus this dossier (19) and the living file `docs/PROOFLABAI-FULL-PROJECT-ARCHITECTURE.md`.
