# Legacy, duplicate and waste dependency map (3 Oct 2026)

Read-only. **Nothing was deleted.**
- **Basis:** the 2 Oct legacy audit and the 3 Oct `LEGACY-RETIREMENT-MAP` were both made at the same HEAD `d736e4d`; HEAD has not changed since.
- **Re-verified today (SRC):**
  - importers of every suspect module;
  - unreachable modal branches;
  - TPO orphans;
  - admin nav;
  - company tabs;
  - 9 legacy slugs and their callers;
  - row counts of every legacy table (DATA).

Classes: KEEP_CURRENT · REMOVE_NOW · REPLACE_THEN_REMOVE · HISTORICAL_DB_KEEP · UNKNOWN.

## 1. Counts (unchanged from 3 Oct; re-verified)

| Class | Count |
|---|---|
| Legacy components overall | about 64 |
| REMOVE_NOW: frontend files with zero behaviour change (orphans + unreachable modals/hooks) | 30 |
| REMOVE_NOW: visible legacy UI items (after an owner decision) | 8 |
| REPLACE_THEN_REMOVE | 22 |
| UNKNOWN (needs an owner decision) | 2: GitHub/LinkedIn profile links; `/recruiter/:linkId` |
| Server functions to retire after the UI | 9 |
| Legacy-only RPCs | 4: `cosign_proof`, `cosignable_proofs`, `my_cosigns`, `set_proof_publicity` |
| HISTORICAL_DB_KEEP | 12 tables + `student_profiles.trust_score` + 7 triggers (all 0 rows) |
| Storage | `gs://prooflab-private-508214/proofs/`: 1 object with no row (U7) |

## 2. Retired concepts: verified dependencies (SRC at HEAD, DATA)

| Concept | Still reachable by | Current code depending on it internally | Class |
|---|---|---|---|
| Trust Score | Student trust card/chart, TPO trust field, admin Trust & XP, Assign-tasks trust filter | `form_squads` balancing, `get_leaderboard`, `tpo_students` read `trust_score` (L7) | REPLACE_THEN_REMOVE (DB readers first) |
| Upload Proof / `proof_uploads` | Admin Proof Review, `/review-proofs`, company Submissions, `recruiter_lots`, Portfolio, public Portfolio, Roadmap status, Build-log Entries | 7 current DB functions keep compat branches; `transcription-enqueue` accepts `proof_id`; voice guard trigger branch | REPLACE_THEN_REMOVE |
| Conceptual questions | `ConceptualQuestionsModal` **unreachable**; realtime subscriptions in "Your tasks" and Entries | none current | REMOVE_NOW (subscriptions + modal) |
| Cosigns | Build-log → Cosigns tab | none | REMOVE_NOW (after the decision) |
| Old Proof Review | admin Work Queue → Proof Review; `/review-proofs` | `useFullVerification` → ai-authorship, github-check, question-generator, response-evaluator, trust-compute; `useVerifyProof` → verify-proof | REPLACE_THEN_REMOVE (admin needs a current review queue: Flagged) |
| LeetCode / HackerRank | Build-log → Progress → `CodingStreaks` → `leetcode-streak-sync` | none | REMOVE_NOW (decision) |
| GitHub verification | admin Proof Review only | none | REMOVE with Proof Review |
| Old recruiter proof viewer | `/recruiter/:linkId` (0 links), orphan `ProofViewer` | none | UNKNOWN (decision) / REMOVE_NOW (ProofViewer) |
| Old company submissions | company Work → Submissions (L1) | `useStartupSubmissions`, `useStartupStats`, `useStartupActivity` | REPLACE_THEN_REMOVE (**P1**) |
| Old public proof | `/portfolio/:slug` | `usePortfolioProjects` | REPLACE_THEN_REMOVE |
| Appeals / reflections | `AppealSubmissionModal`, `ReflectionModal`, `useProofAppeals`, `useReflectionRequest`: orphans | none | REMOVE_NOW |
| Proof stats / notifications | admin Overview/Analytics, college Notifications | admin stats RPCs | REPLACE_THEN_REMOVE |

`ai-authorship` re-checked as point 97 asked:
- **its only callers are `useFullVerification`**, used by the admin `ProofSubmissionsContent` and the orphan `UploadedProofs`;
- no current flow (written grading, voice, resume) calls it;
- so it is legacy by dependency, not by name.

## 3. Duplicated systems (consolidation opportunities; none done)

| Area | Implementations | Evidence |
|---|---|---|
| Coding test generation | `auto-config` (validated by execution) vs `resume-coding-generate` (unvalidated) | SRC |
| Coding grading loop | `gradeTests` + `redact` vs the resume-code-execute own loop (no redact, different denominator) | SRC |
| Task generation | `lot-writer` (auto-config), `assign_tasks` (AI text + auto-config), roadmap tasks (AI text + generic), Sponsored Lots (human + generic), company Post Task (human + generic) | SRC |
| Question generation | resume questions, retest, mock interview, legacy conceptual `question-generator`, Track quizzes | SRC |
| Rubric grading | `gradeOnce` (current) vs `response-evaluator` (legacy) | SRC |
| Proof/submission data | `task_submissions` vs `proof_uploads` | SRC + DATA |
| Company vs Recruiter | role `startup` + orgs `startups` **and** `recruiters`; two Work systems (Post Task/Applications/Submissions vs Sponsored Lots/Shortlist) | SRC |
| Auth checks | `authz.ts` + per-function checks + RLS (all three, because of F2) | SRC |
| AI provider calls | single helper ✓ (no duplication) | SRC |
| Voice | async server path + legacy browser path in the same modal | SRC |
| Org approval | `colleges.verification_status`, `startups.verification_status`, `recruiters.verified` | SRC |

## 4. Waste inventory (do not delete; listed only)

| Item | Kind | Evidence |
|---|---|---|
| 9 legacy function slugs in production | dead endpoints, still public | CFG `/ready` 40/40 |
| 30 orphan or unreachable frontend files | dead code | SRC |
| Realtime subscriptions on `proof_uploads` / `conceptual_tests` | wasted connections per open screen | SRC |
| `prooflab-staging-tasks-test-worker` service | temporary test worker | CFG |
| `prooflab-staging-inspect4` job (postgres:17 image) | leftover diagnostic job | CFG |
| `prooflab-staging-ai-background` queue | queue with no producer | CFG + SRC |
| `interview-scraper/` | unused code | SRC |
| Secrets for removed test logins: `prooflab-e2e-password`, `prooflab-student-password`, `prooflab-recruiter-password`, `prooflab-startup-password`, `prooflab-testusers-password`, staging test passwords | unused secrets (some still readable by the compute SA) | CFG |
| Public runner fallbacks | unnecessary external dependency for graded paths (F10) | SRC |
| crawler image toolchain (node, mcporter, Exa MCP config) | installed, never used except `gh` and `yt-dlp` | SRC |
| 12 legacy tables + trust column | empty tables | DATA |
| Gemini / Kimi code paths in `llm.ts` | dormant (keys unset) | CFG |
| Duplicate AI generation | rubric-config orphans on a lost lot-writer race; unvalidated resume tests regenerated per new profile | SRC |
| 72 roadmap tasks on the generic checklist | low-value work items cluttering "Your tasks" | DATA |
| Removed students' files (65 resumes / 32 voice for 17 students) | storage orphans (N2) | CFG |

## 5. Removal dependency order (summary; full order in `FINAL-IMPLEMENTATION-DEPENDENCY-PLAN`)

1. Delete the 30 orphan/unreachable files and the realtime subscriptions.
2. Build current replacements: company submissions and Sponsored Lots on `task_submissions`; admin review on `task_submissions` flags; Portfolio from passed work.
3. Remove the visible legacy UI.
4. Remove the 9 slugs (and the `/ready` expectation).
5. Rewrite the DB readers (`form_squads`, leaderboard, `tpo_students`, compat branches).
6. Drop the legacy RPCs, triggers and tables plus the trust column, after a backup.
7. Clean storage orphans.
