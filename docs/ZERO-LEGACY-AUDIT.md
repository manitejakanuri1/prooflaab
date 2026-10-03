# Zero-legacy audit

Branch `work/stabilization`, 3 Oct 2026. Staging only: **production still contains every legacy object** until the rollout stages are approved.

**Result: 0 occurrences of 45 retired identifiers in active source.** Enforced on every push by `scripts/legacy_guard.py` (CI step "Retired architecture has not come back", and the release gate).

ProofLab's one evidence model is `task_submissions` + `voice_explanations` + resume assessments + current student/college/company/squad data.

## How the audit was done

1. `python scripts/legacy_guard.py --report` over all 924 tracked files.
2. Active source = everything except migration history (`migration/`, `supabase/migrations/`, `supabase/tests/`), documents (`docs/`, `*.md`), the infrastructure snapshot and the one-off `step6*` scripts. History is not rewritten.
3. Database: functions, triggers, views, policies and foreign keys searched on staging before each drop; every drop migration repeats that search itself and refuses to run if anything depends on what it removes.
4. Scheduler: the 12 production jobs and the staging job were read from `infra/*/scheduler.json`; none calls a retired function.
5. Storage: `proofs/` does not exist in the staging bucket; the files service no longer serves that bucket name.

## Per term

| Term | Active | Allow-listed | Historical | Decision | Evidence of zero active callers |
|---|---|---|---|---|---|
| `proof_uploads` | 0 | 9 (generated types, production check script) | 310 | DEAD → table dropped on staging (66) | no select/insert in `src/`, functions, services; DB guard in 66 passed |
| `proof_id` | 0 | 79 (recorder marker compatibility + its tests + harnesses) | 97 | COMPATIBILITY ONLY in the browser; DB column dropped on staging (71) | recorder no longer selects/inserts it; enqueue no longer sends it; guard in 71 passed |
| `trust_score`, `trust_scores` | 0 | 8 (generated types) | 262 | DEAD → column and table dropped on staging (66) | 4 DB functions rewritten (59), 3 company functions (64); UI removed |
| `cosigns`, `cosign_proof`, `cosignable_proofs`, `my_cosigns` | 0 | 5 | 84 | DEAD → dropped (66) | Cosigns tab and component deleted |
| `conceptual_tests`, `conceptual_answer_keys` | 0 | 5 | 86 | DEAD → dropped (66) | quiz modal, hook and 3 functions deleted |
| `proof_appeals`, `reflection_requests` | 0 | 2 | 29+ | DEAD → dropped (66) | modals and hooks deleted |
| `ai_verifications`, `github_verifications`, `coding_streaks` | 0 | 6 | 88 | DEAD → dropped (66) | functions `ai-authorship`, `github-check`, `leetcode-streak-sync` deleted |
| `set_proof_publicity`, `activity_from_proof`, `on_proof_change`, `on_proof_reviewed` | 0 | 1 | 58 | DEAD → dropped (66) | portfolio/privacy read `portfolio_work()` |
| `recruiter_links`, `recruiter_link_views`, `RecruiterView` | 0 | 6 | 78 | DEAD → dropped (66); route `/recruiter/:linkId` removed | nothing created such links |
| `task_applications`, `useTaskApplications`, `StartupPostTaskPage` | 0 | 2 | — | DEAD → table dropped on staging (72) | company overview, 4 hooks, student query removed with the final navigation |
| 9 server functions (`verify-proof`, `trust-compute`, `question-generator`, `response-evaluator`, `submit-conceptual-answers`, `proof-file-url`, `ai-authorship`, `github-check`, `leetcode-streak-sync`) | 0 | 9 (the check that they answer 404) | 224 | DEAD → deleted; router 41 → 32 | staging: all nine answer 404 for users and for the server |
| Screens/hooks (`ReviewProofs`, `ProofSubmissionsContent`, `TrustXPModeration`, `useProofUploads`, `useProofAppeals`, `useConceptualTests`, `useReflectionRequest`, `StudentUploadsPage`, `StudentCosigns`, `CodingStreaks`, `review-proofs`) | 0 | 0 | 116 | DEAD → deleted | — |

## Still referencing a legacy name on purpose (9 files, each with a reason in the guard)

| File | Classification | Why it stays |
|---|---|---|
| `src/integrations/supabase/types.ts` | GENERATED | Describes the production schema, which still has the tables. Regenerate after the production cleanup. |
| `src/lib/voiceJob.ts` + 4 test files | COMPATIBILITY ONLY | A recording in progress keeps a marker in the browser; markers written by older builds carry a proof field. Keeping the optional field means a student mid-recording during a release is not orphaned. Never read from the server. Removable one release after production rollout. |
| `scripts/dev-tools/voice_modal_*_browser.mjs` | COMPATIBILITY tests | Recorder harnesses that simulate those older markers. |
| `scripts/dev-tools/staging_function_authz_check.py` | KEEP | Asserts the nine retired functions answer 404. |
| `scripts/dev-tools/authz_matrix_check.py`, `gen_guide_appendix.py` | PRODUCTION / doc tooling | Production still has the objects; update at rollout stage 7. |

## Things that looked dead and are not

| Object | Decision | Why |
|---|---|---|
| `task_assignments` | KEEP | Read by `record_task_submission`, `review_task_submission`, `rubric_task_view`, `sandbox_task_view`, `start_task_assignment`, `tpo_attention` (college/admin-assigned tasks). |
| `job_opportunities` (company "Job posts") | KEEP — current | Approved posts are a source for Lots. |
| Badges and quests | KEEP — current | Written by `record_activity` on real passes. |

## Removed in this phase

| Kind | Removed |
|---|---|
| Routes | `/recruiter/:linkId`, `/review-proofs` (26 → 25) |
| Frontend files | 24 (wave 2) + StudentUploadsPage, AppealSubmissionModal, ReflectionModal, ConceptualQuestionsModal, StudentCosigns, CodingStreaks, ReviewProofs, ProofSubmissionsContent, TrustXPModeration, VerificationPanel, VerificationDropdown, RecruiterView, PublicProjectCard, ProofFileButton, PublicSuggestedStudents, StartupViewTasksPage, StartupPostTaskPage, StartupViewApplicationsPage, EditTaskDialog, StartupDashboardOverview, StudentVoiceExplanationsCard |
| Hooks / libs | useReflectionRequest, useProofAppeals, useConceptualTests, useFullVerification, useVerifyProof, usePortfolioProjects, useProofUploads, proofFile, useStartupStats, useStartupActivity, useStartupTasks, useTaskApplications, useVoiceExplanations |
| Server functions | the 9 above; `_shared/authz.ts` (+ test) |
| DB functions (staging) | cosign_proof, cosignable_proofs, my_cosigns, set_proof_publicity, activity_from_proof, on_proof_change, on_proof_reviewed, proof_uploads_reject_sandbox, sponsor_lot |
| DB tables (staging, rows archived to `legacy_archive`) | proof_uploads, trust_scores, conceptual_tests, conceptual_answer_keys, proof_appeals, ai_verifications, github_verifications, coding_streaks, cosigns, recruiter_links, recruiter_link_views, task_applications |
| DB columns (staging) | student_profiles.trust_score, voice_explanations.proof_id, student_portfolios.projects |
| Storage | files service no longer serves the `proofs` bucket name (staging). Production proof files: not counted, not touched. |

## Left for later (not legacy-term items)

- The file-grant path (functions sign a short link, files service checks it) lost its only caller with `proof-file-url`. It is dead code with its own secret; removing it touches the files service's security code and is listed as optional cleanup.
- `src/integrations/supabase/types.ts` regeneration (after production cleanup).
