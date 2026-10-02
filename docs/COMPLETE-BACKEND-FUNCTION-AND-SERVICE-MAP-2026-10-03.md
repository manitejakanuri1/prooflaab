# Complete backend function and service map (3 Oct 2026)

Read-only.
- **SRC** at HEAD `d736e4d`.
- **CFG**: `/ready` 40/40 on functions `00053-c7m`, verified on 3 Oct (RUN, earlier in this audit session).

## 1. Repository map (SRC)

| Directory | Purpose | Status | Called by | Calls | Deployed as |
|---|---|---|---|---|---|
| `src/` | React SPA (pages, components, hooks, lib, integrations/google, recruiter/) | current + legacy screens | browsers | bridge, API, functions, files, transcriber | Firebase Hosting (CI on push to main) |
| `functions-service/` | Deno router: imports 40 handlers, `/ready`, request context | current | browsers, worker, scheduler | handlers | Cloud Run `prooflab-functions` (manual Cloud Build) |
| `supabase/functions/<slug>/` | 40 handlers + `_shared/` (`backend.ts`, `llm.ts`, `sandbox.ts`, `auto-config.ts`, `rubric-grading.ts`, `voiceScore.ts`, `rate-limit.ts`, `audit.ts`, `authz.ts`, `cors.ts`, `log.ts`, `levels.ts`, `explain.ts`, `excerpt.ts`, `scratch.ts`, `skill-map.ts`, `role-skills.ts`, `submission.ts`, `json-array.ts`, `serve.ts`) | current; 9 handlers legacy | router | PostgREST, GCS mounts, runner, DeepSeek, Resend, Cloud Tasks, accounts | inside the functions image |
| `supabase/migrations/` | 139 SQL files (Supabase-era history + mirrors) | historical / partial | humans | — | not auto-applied |
| `migration/` | 66 SQL files: Google-era 01–49, Step 6 production/staging scripts, rollbacks | current source of DB changes | owner via `gcloud sql import` | — | manual |
| `auth-bridge/` | Deno: Google ID token → HS256 ticket | current | browsers | PostgREST | `prooflab-auth-bridge` |
| `files-service/` | Deno: private/public file access with ticket rules | current | browsers | GCS | `prooflab-files` (image `v-no-vercel`) |
| `accounts/` | Python: Identity admin (remove, password link, sync) | current | scheduler, functions | Identity Platform, PostgREST | `prooflab-accounts` |
| `code-runner/` | Python: 8-language executor | current | functions | — | `prooflab-code-runner` |
| `transcriber/` | Python: faster-whisper | current | worker (and the legacy browser path) | — | `prooflab-transcriber` |
| `transcription-worker/` | Python: Cloud Tasks target | current | Cloud Tasks | GCS, transcriber, PostgREST, functions | `prooflab-transcription-worker` |
| `tasks-test-worker/` | Python: staging Cloud Tasks test target | **temporary** | staging test | — | `prooflab-staging-tasks-test-worker` (still deployed) |
| `crawler/` | Python: source fetcher | current | Scheduler job | Jina, GitHub, YouTube, RSS, PostgREST | job `prooflab-crawler` |
| `bug-finder/` | Node Playwright robot | current (failing: N1) | Scheduler job | live site, PostgREST | job `prooflab-bug-finder` |
| `interview-scraper/` | Python PrepInsta scraper | **unused** (no deploy, no caller) | none | — | not deployed |
| `content/syllabus/` | 41 course syllabus JSONs | current data source for Tracks (applied by migrations 28/32) | scripts | — | data in DB |
| `scripts/` | healthcheck, attack surface, authz matrix, monitoring setup, deploy-hosting, 40+ dev tools | current tooling | humans, CI (deploy-hosting) | live services | — |
| `.github/workflows/` | `deploy.yml` (test + Hosting), `crawl.yml` (manual) | current | GitHub | Firebase Hosting | — |
| `docs/` | runbooks, closure, audits | mixed (drift, see the dossier) | humans | — | — |
| `public/`, `dist/` | static assets / local build output | — | — | — | — |

## 2. The 40 function slugs (SLUGS in `functions-service/main.ts`)

| Slug | Purpose | Frontend caller (SRC) | Other caller | AI | Tables (main) | Class |
|---|---|---|---|---|---|---|
| ai-authorship | AI-authorship verdict on a proof | `useFullVerification` (admin Proof Review) | — | yes | proof_uploads, ai_verifications | **LEGACY** |
| app-guide-chat | Help chatbot | `AppGuideChatbot` (global) | — | yes (cache) | — | current |
| assign_tasks | Admin/college create + assign tasks (AI text + grading config) | `AssignTasksScreen` | — | yes | tasks, task_assignments, configs | current |
| client-log | Browser step trail | `lib/tracker.ts` | — | no | app_events | current |
| create-college-user | Admin creates a college login | `CollegeOversight` | — | no | colleges, user_roles; Identity | current |
| create-student-users | CSV import / admin create | `TpoImportStudents`, `CollegeDashboardOverview`, `StudentOversight` | — | no | student_*; Identity; Resend | current (F4, F19) |
| github-check | GitHub repo verification for proofs | `useFullVerification` | — | no | github_verifications | **LEGACY** |
| interests-analyze | Skip-resume analysis | `InterestReview` | — | yes (cache) | student_interests | current |
| leetcode-streak-sync | LeetCode/HackerRank streaks | `CodingStreaks` (Build-log → Progress) | — | no | coding_streaks (0) | **LEGACY but reachable** |
| level-open | Open a topic (writes it if missing) | `LevelDetail` | — | yes (rare) | level_*, student_levels | current |
| level-quiz-submit | Track quiz grading | `LevelDetail` | — | no | student_levels | current |
| levels-place | Placement on tracks | `LevelMap` | — | no | student_tracks | current |
| levels-warm | Batch-write topics | — | `scripts/dev-tools/warm_all.py` (admin) | yes | level_content | current (ops) |
| lot-writer | Write the AI Lot template | `StudentDailyCard` | — | yes | lot_templates, configs, tasks, task_explainers | current |
| mock-interview-generate / -score | Mock interview | `MockInterview` | — | yes | mock_interviews (0) | current (low use) |
| proof-file-url | Grant to read a proof file | `lib/proofFile.ts` (Portfolio, RecruiterView, admin, startup submissions, StudentUploadsPage) | — | no | proof_uploads | **LEGACY** (callers are legacy/mixed) |
| question-generator | Conceptual questions after a proof | `UploadProofModal` (unreachable), `useFullVerification` | — | yes | conceptual_tests | **LEGACY** |
| response-evaluator | Grade conceptual answers | `UploadedProofs` (orphan), `useFullVerification` | — | yes | conceptual_tests | **LEGACY** |
| resume-assessment-submit | Grade quiz + roadmap | `TimedResumeAssessment` | — | yes | resume_assessments, resume_scorecards, tasks | current |
| resume-code-execute | Resume coding run/submit | `TimedResumeAssessment` | — | no | resume_assessments, resume_scorecards | current |
| resume-coding-generate | Resume coding problems | `TimedResumeAssessment` | — | yes (template cache) | ai_templates, resume_assessments | current |
| resume-improve | Resume rewrite | `ResumeCheckFlow` | — | yes | resume_claims | current |
| resume-parser | Resume claims | `ResumeCheckFlow`, `IntakeChoice` | — | yes | resume_claims | current |
| resume-question-generator | Quiz questions | `ResumeCheckFlow`, `InterestReview`, `StudentInterestOnboarding` | — | yes | resume_assessments | current |
| resume-retest-generate | Retest | `ResumeCheckFlow` | — | yes | resume_assessments | current |
| run-code | Free run (scratchpad, lessons), own runner only | `CodeRunBox` | — | no | — | current |
| run-sandbox | Visible-test run / admin config check | `SandboxTaskPanel` | — | no | task_sandbox_config | current |
| scheduled-job | 7 timed RPCs | — | Scheduler (webhook secret) | no | many | current |
| security-log | Browser security events | `lib/securityLog.ts` | — | no | security_events | current |
| send-onboarding-email | Welcome / invite mail (Resend) | `OnboardingModal`, `EnhancedRoleBasedAuthForm` | functions (import) | no | — | current |
| submit-conceptual-answers | Conceptual answers | `ConceptualQuestionsModal` (unreachable) | — | no | conceptual_tests | **LEGACY** |
| submit-sandbox-task | Coding submit | `SandboxTaskPanel` | — | no | task_submissions | current |
| submit-written-task | Written submit | `WrittenTaskPanel` | — | yes | task_submissions | current |
| task-explain | Simple-words view | `SimpleQuestion` | lot-writer (inline helper) | yes | task_explainers | current |
| transcription-enqueue | Voice job | `VoiceExplainModal` | — | no | voice_explanations; Cloud Tasks | current |
| transcription-reap | Voice recovery | — | Scheduler every minute | yes (re-score) | voice_explanations | current |
| trust-compute | Trust score | `useFullVerification`, `UploadedProofs` | — | no | trust_scores, student_profiles.trust_score | **LEGACY** |
| verify-proof | AI proof verification | `useVerifyProof` (admin) | — | yes | proof_uploads | **LEGACY** |
| voice-score | Voice scoring | `VoiceExplainModal` (legacy sync path) | worker, reaper | yes | voice_explanations | current |

Totals: **31 current**, **9 legacy**:
- ai-authorship
- github-check
- leetcode-streak-sync
- proof-file-url
- question-generator
- response-evaluator
- submit-conceptual-answers
- trust-compute
- verify-proof

`ai-authorship` is legacy because of its callers, not its name: its only callers are the admin Proof Review hooks on `proof_uploads`, which has 0 rows.

## 3. Shared-library dependency facts (SRC)

| Library | Talks to the DB via | Works in production? |
|---|---|---|
| `backend.ts` createClient | `POSTGREST_URL` + minted service_role | yes |
| `llm.ts` logUsage / cache | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | **no: env absent (F3)** |
| `rate-limit.ts` checkRateLimit / guard | same | **no: fails open (F3)** |
| `audit.ts` logSecurityEvent | same | **no** |
| `log.ts` | stdout JSON | yes |
| `authz.ts` | client passed in | yes |

## 4. Service-to-service calls (SRC + CFG)

| From | To | Auth |
|---|---|---|
| browser | api, functions, files, transcriber (legacy path), bridge, accounts (read `/ready` only) | HS256 ticket / ID token |
| functions | api | minted service_role |
| functions | code-runner | `x-runner-secret` |
| functions | accounts | `x-webhook-secret` (`ACCOUNTS_URL`, `backend.ts:448`) |
| functions | Cloud Tasks | rt-functions credentials + actAs tasks-invoker |
| functions | functions | in-process `functionsShim` (loopback) |
| worker | GCS, transcriber, api, functions `/voice-score` | own SA; minted tickets |
| scheduler | functions, accounts | `x-webhook-secret` |
| scheduler | Run Jobs API | OAuth rt-scheduler |
| crawler / bug-finder | api | minted service_role |
