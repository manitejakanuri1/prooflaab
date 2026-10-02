# End-to-end flow matrix — 3 Oct 2026

Status: WORKS_END_TO_END · PARTIAL · CODE_EXISTS_NOT_PROVEN · BROKEN · LEGACY · UNKNOWN.
Evidence: SRC (source now) · CFG (cloud config now) · DATA (prod read-only now) · RUN (test now) ·
EARLIER (run by Claude 30 Sep–2 Oct, not re-run) · NT (not tested).

**Live-test limitation today:** the test student (smoke01) and test company (company01) logins were
deleted by the team (CFG, 3 Oct). Student and company journeys could not be re-proven today.

## Student

| Flow | Path traced | Status | Evidence | Notes |
|---|---|---|---|---|
| Sign-in | browser → Identity Platform → auth-bridge (RS256 verify → HS256 ticket) → PostgREST RLS | WORKS_END_TO_END | EARLIER (4 roles); RUN attack surface 66/66 | email verification enforced only in browser (F4) |
| Self sign-up | Auth.tsx → Identity signUp → `user_roles_self_claim` insert from browser | PARTIAL | SRC | roles self-claimed (F5) |
| Invited student (CSV) | TPO import → create-student-users → createUser + profile + roles + email | WORKS_END_TO_END | EARLIER (2 Oct, smoke01 created via import) | not transactional (F19); links unverified accounts (F4) |
| Onboarding / consent | StudentStart, voice consent RPC | CODE_EXISTS_NOT_PROVEN | SRC | not re-tested |
| Resume upload / extraction / ATS / rebuild / test / scorecard | browser pdfjs → resume-parser/-question-generator/-coding-generate/-assessment-submit → DeepSeek | CODE_EXISTS_NOT_PROVEN in this audit; deep bug finder exercised it | EARLIER (bug finder deep 6/6 on 30 Sep) | AI usage not logged (F3); PII to DeepSeek (F15) |
| Roadmap / Tracks / quiz | level-open, level-quiz-submit | WORKS_END_TO_END (1 Oct) | EARLIER (healthcheck 24/24) | Roadmap stage state reads proof_uploads (legacy compat) |
| Floor: Daily Lot | scheduler 05:40 IST → scheduled-job → create_lot_for → next_lot_source | WORKS_END_TO_END | SRC + CFG scheduler | not personalised (N6) |
| Written task + scratchpad | WrittenTaskPanel → run-code → code-runner; submit-written-task → DeepSeek → record_task_submission | WORKS_END_TO_END (1 Oct) | EARLIER; DATA 14 submissions | no AI timeout (F14) |
| Coding task | SandboxTaskPanel → run-sandbox / submit-sandbox-task → code-runner (public fallback) | WORKS_END_TO_END (1 Oct) | EARLIER | F8, F9, F10 |
| Required voice after submit | — | **PARTIAL / not as intended** | SRC | voice is a separate optional button; not requested after Submit; unlimited recordings (N4) |
| Voice async pipeline | files → transcription-enqueue → Cloud Tasks → worker → Whisper → voice-score → DB | WORKS_END_TO_END (1 Oct, scored 72) | EARLIER; DATA 10 scored rows | F11, F12, F13, N5 |
| Build-log | Entries tab: legacy "My Uploads" + current voice card | PARTIAL | SRC | voice card current; work submissions not shown as linked entries |
| Progress | weekly points, submissions/pass-rate (fixed 2 Oct), trust (legacy, always 0), streaks (legacy) | PARTIAL | SRC + RUN build/live bundle 2 Oct | L3 |
| Squad | squads, members, matches | PARTIAL | SRC | teammate names hidden by RLS (N3) |
| Profile / portfolio / privacy | resume history, portfolio (proof_uploads), privacy (proof section) | PARTIAL / LEGACY | SRC | L5 |
| Recruiter visibility | student_is_discoverable → recruiter_talent | CODE_EXISTS_NOT_PROVEN with a discoverable student | EARLIER (0 candidates) | F12 (browser scores counted, 46 on hold) |

## College / TPO

| Flow | Status | Evidence | Notes |
|---|---|---|---|
| Login, college isolation | WORKS_END_TO_END | EARLIER authz 58/58 (2 Oct); RUN 66/66 | |
| CSV import, validation, duplicates, other-college refusal | WORKS_END_TO_END (single student) | EARLIER (2 Oct import) + SRC | bulk validation NT |
| Squad formation (11, by section, reserve) | CODE_EXISTS_NOT_PROVEN now | SRC `form_squads` (`< 11`, `k := n / 11`, per cohort) | earlier simulated with 212 students (HISTORY) |
| Standings / weekly / seasons | CODE_EXISTS_NOT_PROVEN | SRC run_squad_week, run_all_seasons, advance_season; CFG scheduler Sun 23:30 IST | |
| Insights / reports (college-only after Migration 49) | WORKS_END_TO_END | EARLIER (2 Oct) | |
| Remove students | WORKS_END_TO_END | DATA removals 2 Oct | removes rows, **not files** (N2) |
| Trust score in student list/profile | LEGACY | SRC | L3 |

## Recruiter / Company (same role `startup`; Recruiter dashboard redirects to Company)

| Flow | Status | Evidence | Notes |
|---|---|---|---|
| Signup, approval (`is_verified_recruiter`) | WORKS_END_TO_END (1 Oct) | EARLIER | login since deleted (N1) |
| Talent search | WORKS_END_TO_END (0 candidates) | EARLIER | no discoverable students to prove positive path |
| Proof profile | PARTIAL | SRC | draws on proof_uploads + all voice rows (F12, L7) |
| Shortlist | CODE_EXISTS_NOT_PROVEN | SRC | |
| Post task / sponsored Lot → student | CODE_EXISTS_NOT_PROVEN | SRC | |
| Student submission → company review | **BROKEN** | SRC + DATA | reads proof_uploads (L1) |
| Hiring decision / placement | CODE_EXISTS_NOT_PROVEN | SRC | 0 hires |
| `/recruiter/:linkId` share links | LEGACY | SRC + DATA | L4 |

## Admin

| Flow | Status | Notes |
|---|---|---|
| Admin role (user_roles, not self-claimable) | WORKS_END_TO_END | EARLIER |
| People, Content Library, Token Usage, Security Events, Student Trace, Bug Finder, Settings | CODE_EXISTS_NOT_PROVEN per screen | dashboards load (EARLIER); Token Usage empty because of F3 |
| Flagged (needs_review task_submissions) | CODE_EXISTS_NOT_PROVEN | current; no needs_review rows to test |
| Proof Review, Trust & XP, `/review-proofs` | LEGACY | L2 |
| Overview/Analytics/People/Task Oversight numbers | PARTIAL | proof_uploads-based tiles always 0 |

## Cross-role

| Journey | Status |
|---|---|
| Student work → TPO dashboard | WORKS (insights, student list) — EARLIER |
| Student work → company review | **BROKEN** (L1) |
| Company sponsored Lot → student | CODE_EXISTS_NOT_PROVEN |
| Admin moderation → current system | PARTIAL (Flagged is current; Proof Review/Trust are legacy) |
