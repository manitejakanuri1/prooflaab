# Legacy retirement map — 3 Oct 2026

Re-verified against HEAD `d736e4d` (= main). Detailed per-file table with callers, routes, tables and
replacements: `docs/LEGACY-SYSTEM-AUDIT-2026-10-02.md` (still accurate: no code changed since). This
file confirms each item now and gives the exact counts.

Method: import graph from `src/main.tsx` (static + dynamic imports), then every `<Route>` and every
navigation mapping (student tabs, college sidebar, `adminNav.ts` + `AdminDashboard.tsx` cases, company
sidebar); server `SLUGS`; 13 scheduler targets; triggers/functions from the migration history; production
row counts (read-only).

## Legacy tables — the exact list (resolves "9 vs 12")

"9" counted the core proof/trust/conceptual tables; "12" added the recruiter-link pair and verification
settings. The exact list is **12 tables + 1 column**:

| Table | Prod rows (3 Oct) | Still referenced by current code? |
|---|---|---|
| proof_uploads | 0 | yes: guard_voice_explanations_insert, record_activity, recruiter_talent/proof_profile/home/lots, tpo_student_profile, remove_students, many screens |
| trust_scores | 0 | StudentProgressPage, trust-compute |
| conceptual_tests | 0 | StudentUploadsPage, StudentAssignedTasksPage (dead branch), functions |
| conceptual_answer_keys | 0 | question-generator, submit-conceptual-answers |
| cosigns | 0 | StudentCosigns + cosign RPCs |
| github_verifications | 0 | github-check, ProofSubmissionsContent |
| ai_verifications | 0 | ai-authorship, ProofSubmissionsContent |
| proof_appeals | 0 | AppealSubmissionModal (Entries) |
| coding_streaks | 0 | CodingStreaks, leetcode-streak-sync |
| recruiter_links | 0 | RecruiterView (public route) |
| recruiter_link_views | 0 | RecruiterView |
| verification_settings | not counted | orphan VerificationSettingsPage only |
| column `student_profiles.trust_score` | always 0 | tpo_students, tpo_student_profile, form_squads, get_leaderboard, recruiter fns, 10+ screens |

Staging row counts: NOT COUNTED (would need staging reads; not required for a decision because no
production data exists).

## Re-check of the 25 listed items (all at HEAD `d736e4d`)

| # | Item | Result |
|---|---|---|
| 1 | StudentProgressPage Trust Score | still present (card, history chart, indicator bar) |
| 2 | Cosigns tab | still present (Build-Log) |
| 3 | CodingStreaks exposed | still present (Progress) |
| 4–7 | LeetCode / HackerRank / GitHub / LinkedIn in CodingStreaks | all present; GitHub/LinkedIn saved to `student_contact` and **returned to recruiters** by `recruiter_proof_profile` |
| 8–9 | StudentUploadsPage uses proof_uploads / conceptual_tests | yes; it is the **Entries** tab and also hosts the **current** `StudentVoiceExplanationsCard` |
| 10–11 | StudentAssignedTasksPage UploadProofModal / conceptual logic | present but unreachable (`setSelectedTaskId` only set to null; quiz needs a conceptual_tests row) |
| 12–13 | Admin nav Proof Review / Trust & XP | present (`adminNav.ts`) |
| 14 | ProofSubmissionsContent old verification | present, reachable |
| 15–16 | TrustXPModeration proof_uploads / trust_score | present, reachable, writes trust_score |
| 17 | TPO profile trust_score | present |
| 18 | Company submissions proof_uploads | present → **L1 (P1)** |
| 19–20 | RecruiterView trust filter / verified proofs | present; route reachable, unusable (0 links, no creator UI) |
| 21 | Retired endpoints registered | 9 in SLUGS |
| 22 | proof-file-url frontend callers | 6 callers, all proof_uploads-based screens |
| 23 | useAllStudentTasks proof compatibility | present |
| 24–25 | transcription-enqueue proof_id + proof_uploads check | present; no frontend sends proof_id; DB guard also checks it |

## Counts

| Class | Count | Items |
|---|---|---|
| Legacy components (anything not KEEP_CURRENT) | **~64** | 30 removable files + ~22 replace-first + 2 decisions + 9 server fns + DB objects |
| REMOVE_CODE_NOW (safe, zero behaviour change) | **30 files** + 1 dead branch set | 22 orphans, ProofViewer (no route), UploadProofModal, ConceptualQuestionsModal, useConceptualTests, AppealSubmissionModal, ReflectionModal, useProofAppeals, useReflectionRequest |
| REMOVE_UI_NOW | **8** | Student trust card/chart/bar, LeetCode/HackerRank box, Cosigns tab, Privacy proof section, TPO trust field, Admin Proof Review, `/review-proofs`, Assign-tasks trust filter |
| REPLACE_BEFORE_REMOVE | **22** | Entries (StudentUploadsPage), useAllStudentTasks, StudentRoadmapPage, StudentPortfolioPage, useProofUploads, college Notifications (+hook), Trust & XP → XP-only, Admin Overview/Analytics/People/Task Oversight (4), company Submissions/Stats/Activity (3), public Portfolio (+2 hooks), transcription-enqueue proof_id, DB guard branch, 7 DB functions with compat branches (counted as 1 migration), trust_score readers (form_squads, get_leaderboard, tpo_students) |
| UNKNOWN_NEEDS_DECISION | **2** | GitHub/LinkedIn links (recruiters see them), `/recruiter/:linkId` (remove or rebuild) |
| HISTORICAL_KEEP_TEMPORARILY | 12 tables + 1 column + 7 triggers | until final cleanup |
| Server functions to retire after UI | **9** | verify-proof, github-check, ai-authorship, trust-compute, question-generator, response-evaluator, submit-conceptual-answers, proof-file-url, leetcode-streak-sync |
| Legacy-only RPCs | 4 | cosign_proof, cosignable_proofs, my_cosigns, set_proof_publicity |

Storage: `gs://prooflab-private-508214/proofs/` holds **1 object** with no `proof_uploads` row (U7).

## Order (dependency-safe) — see `docs/CLEANUP-AND-COMPLETION-ORDER-2026-10-03.md`
