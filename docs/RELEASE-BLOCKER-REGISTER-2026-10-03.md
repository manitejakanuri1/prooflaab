# Release blocker register — 3 Oct 2026 (single authoritative list)

Read-only audit. Original IDs are kept (F = Architecture-Flaws doc, D = PDR contradictions, G = 1 Oct
closure register, L = legacy audit 2 Oct, N = new in this audit).
Evidence tags: **SRC** source inspected now · **CFG** live cloud config read now (read-only) ·
**DATA** production read-only count now · **RUN** test executed now · **EARLIER** executed by Claude
on 1–2 Oct in this session, not re-run now · **DOC** document only · **NT** not tested.

Severity: P0 immediate security/data loss · P1 release blocker · P2 before broad rollout · P3 can follow
a controlled pilot with acceptance · P4 tech debt.

## Summary

| Severity | Count | IDs |
|---|---|---|
| P0 | 0 | — |
| P1 | 5 | F1, F3, F4, F8, L1 |
| P2 | 14 | F2, F6, F9, F10, F11, F12, F14, F15, F16, F17, N1, N2, N14 (=G35), N19 |
| P3 | 17 | F5, F7, F13, F18, F19, F20, F21, D5, L2, L3, L5, L6, N3, N4, N5, N10, N11 |
| P4 | 9 | D1, D2, D4, L4, L7, L8, N6, N7, N18 |
| Closed / N/A | 2 | D3 (no time shift), Step 6 gates G01–G06/G10/G28 (closed 1 Oct) |
| UNKNOWN (needs live/human evidence) | 9 | U1–U9 (end of file) |

## P1 — release blockers

| ID | Title | Status | Evidence | Where | Impact | Close when |
|---|---|---|---|---|---|---|
| **F1** | One HS256 secret (`prooflab-jwt-secret`) signs student tickets **and** `service_role` tokens; 10 identities can read it | CONFIRMED_OPEN (prod) | SRC `auth-bridge/main.ts` HS256 signer; `_shared/backend.ts:55-71` mints `role=service_role`; `files-service/main.ts:174` accepts HS256. CFG secret readers: compute SA (Cloud Build), rt-accounts, rt-api, rt-authbridge, rt-bugfinder, rt-crawler, rt-files, rt-functions, rt-transcriber, transc-wk | auth-bridge, functions, files, transcriber, accounts, worker, jobs | A code-execution bug in **any** of those services (e.g. a malicious audio file in the transcriber) yields full database access by minting `service_role` | Only the bridge can sign (asymmetric keys); service-to-service via Cloud Run identity; separate file-grant key |
| **F3** | Rate limits, AI usage logging, AI cache and audit log are silently OFF in production | CONFIRMED_OPEN, **PRODUCTION_VERIFIED** | SRC `_shared/rate-limit.ts:56-58` (`return ALLOW_ON_FAILURE` when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` missing), `llm.ts:87-89,261`, `audit.ts:29-31`. CFG prod functions env has neither variable. DATA `llm_usage` last row **11 Sep 2026** (0 since, while 10 recordings were AI-scored and 32 AI Lots exist); `rate_limits` **0 rows** | functions (all AI + run-code limits) | No per-student limits on AI/code (cost + abuse); no cost tracking; no cache hits | Route these through `backend.ts` client; fail at startup if they cannot write; rows appear in `llm_usage`/`rate_limits` on staging and prod |
| **F4** | Email pre-registration can capture a student's identity at CSV import | CONFIRMED_OPEN (code); NT live | SRC `create-student-users/index.ts:141-220` links any existing student account by email with **no** email-verified check; verified-email gate is only in the browser (`Auth.tsx:49`, `AuthCallback.tsx:113`, `EnhancedRoleBasedAuthForm.tsx:145`); bridge issues tickets with `email_confirmed:false` | auth-bridge, create-student-users | Attacker signs up with a student's email before the college imports it, gets linked to that college as the student | Server refuses to link (and RLS/bridge refuse to serve) unverified accounts; test on staging |
| **F8** | Code-runner leftover processes survive a normal run | CONFIRMED_OPEN (code); NT live | SRC `code-runner/server.py:85-95`: `killpg` only in the timeout branch; every run uses the same `runner` uid and `RLIMIT_NPROC 256`; concurrency 1 per instance but instances are reused | prooflab-code-runner | A program that forks a background process can watch/alter later students' runs (incl. hidden-test runs) on that instance | Kill the whole process group/uid after every run (or per-run sandbox); staging test with a forking program |
| **L1** | Company "Submissions" reads the retired `proof_uploads`; students now submit to `task_submissions` | CONFIRMED_OPEN (prod) | SRC `hooks/useStartupSubmissions.tsx:43-94`; DATA proof_uploads 0, task_submissions 14 | company dashboard → Work → Submissions; useStartupStats/Activity | A company that posts work never sees a student's answer — cross-role journey broken | Company submissions/stats read `task_submissions` for `tasks.created_by_startup_id`; staging cross-role test |

## P2 — before broader rollout

| ID | Title | Status | Evidence | Close when |
|---|---|---|---|---|
| F2 | All 40 functions use `service_role` (bypass RLS), permission re-written by hand | CONFIRMED_OPEN | SRC `backend.ts` always mints service_role | Caller-token by default; narrow definer RPCs |
| F6 | Accounts sync deletes every student whose login is missing; no ceiling | CONFIRMED_OPEN | SRC `accounts/server.py:201-217` (pages fully, aborts on error/empty, **no max-delete threshold, no dry run**); DATA 4 `console_sync` removals on 2 Oct | Threshold + alert-before-delete |
| F9 | Code runner: no per-run memory limit; outbound internet open | CONFIRMED_OPEN (config) | SRC no `RLIMIT_AS`; CFG no VPC egress setting, 2 Gi shared, gen2 | Memory rlimit; egress denied (VPC + firewall) ; metadata blocked |
| F10 | Graded code + hidden-test inputs fall back to Wandbox/Godbolt/Glot | CONFIRMED_OPEN | SRC `_shared/sandbox.ts:268-306` (`runCode` → own runner, then public); used by run-sandbox, submit-sandbox-task, resume-code-execute; `run-code` own-only | Disable fallbacks in prod, return "busy" |
| F11 | Scored audio can be overwritten (`x-upsert`) or deleted while the score stays | CONFIRMED_OPEN (code) | SRC `files-service/main.ts:263,309`; owner-folder rule allows it | Write-once scored objects or invalidate score on change |
| F12 | Browser/self-reported voice path still scoreable; recruiters still count it (Migration 46 on hold) | CONFIRMED_OPEN | SRC `voice-score/index.ts:95-101` students may score own `browser` rows; `voice_own_insert` + guard forces `transcript_source='browser'`; recruiter_talent counts all scored rows (46 not applied) | Decide 46; restrict scoring to server transcripts |
| F14 | Student text in the same prompt as marking rules; no AI timeouts | CONFIRMED_OPEN | SRC `llm.ts:118-123,170-175` single `user` message; no AbortSignal | System/user separation, schema validation, timeouts |
| F15 | Student personal data/answers sent to DeepSeek (overseas) | CONFIRMED (needs legal review) | SRC prompts include resume text/answers/transcripts; CFG only `DEEPSEEK_API_KEY` set (Gemini/Kimi keys absent) | Minimisation + disclosure; legal review |
| F16 | CI tests one build (Node 22), deploy rebuilds (Node 20); Python and most Deno tests not in CI | CONFIRMED_OPEN | SRC `.github/workflows/deploy.yml:44,78,100`; deno test only `_shared/` + `transcription-reap/`; 1 Python test file not run | Deploy the tested artifact; run all suites |
| F17 | No single schema source; 41–47 only in `migration/`; three "49" files; no applied-migrations record | CONFIRMED_OPEN | SRC 66 files `migration/`, 139 `supabase/migrations/`, 0 Step-6 mirrors | One folder + applied table + generated types in CI |
| N1 | Test logins unprotected: smoke student and company deleted by the team; monitoring blind | CONFIRMED_OPEN | CFG smoke01 + company01 MISSING (3 Oct); healthcheck 5/6, bug finder failing (EARLIER) | Dedicated protected test college; restore logins |
| N2 | Removed students' files are kept: 65 resumes / 32 voice files for 17 students / 12 voice rows; 1 orphan `proofs/` file | CONFIRMED_OPEN (prod) | CFG `gcloud storage ls` counts | Delete files on removal; retention rule |
| N14 (=G35) | Old compute SA (Cloud Build) can still read every production secret and write both buckets | CONFIRMED_OPEN | CFG secret IAM | Remove leftover grants |
| N19 | Production is used as the team's test environment (bulk removals by the test college, test students mixed with real ones) | CONFIRMED (process) | DATA removed_students 2 Oct; CFG 17 logins incl. team accounts | Separate test college/policy; staging for tests |

## P3 — acceptable for a controlled pilot with explicit acceptance

| ID | Title | Evidence |
|---|---|---|
| F5 | Browser may self-claim student/college_admin/startup/recruiter (not admin); college/recruiter powers gated by approval | SRC policy `user_roles_self_claim` (stage47); `my_college_id` requires approved college; `is_verified_recruiter` |
| F7 | Scheduler endpoints use one static shared secret on public URLs; Deno compares with `!==` | SRC `scheduled-job/index.ts:36`, `transcription-reap/index.ts:38`; accounts uses `compare_digest` |
| F13 | Whisper "base", forced English | SRC `transcriber/server.py:25,57` |
| F18 | Infra only in console/runbooks (no IaC) | SRC no Terraform; scripts only for monitoring/hosting |
| F19 | Multi-step student creation not transactional (login without profile possible) | SRC `create-student-users` createUser then inserts, no rollback; mitigated by `drop_empty_account` |
| F20 | AI usage/cache logged with `void` (not awaited) | SRC `llm.ts:193,343,353` (moot until F3 fixed) |
| F21 | Capacity measured only on half-size staging (≤200 concurrent browse) | EARLIER load test; CFG pool 4×4=16 of 50 |
| D5 | "No upload proof" rule vs code: UploadProofModal, proof_uploads, `proofs/` object, proof functions remain | SRC/CFG |
| L2 | Admin "Proof Review" and "Trust & XP" (writes trust_score) still in the menu; `/review-proofs` duplicate | SRC adminNav.ts, AdminDashboard.tsx |
| L3 | Student/college legacy UI visible: Trust Score, Cosigns, LeetCode/HackerRank/GitHub/LinkedIn, "My Uploads", Privacy proof section, TPO trust | SRC |
| L5 | Public portfolio and student Portfolio built on proof_uploads | SRC usePortfolioProjects, StudentPortfolioPage |
| L6 | 9 retired functions still registered and publicly callable | SRC functions-service SLUGS |
| N3 | Squad Members shows "—" for teammates (RLS hides other profiles) | SRC StudentSquadPage.tsx:93,299 |
| N4 | Voice explanation is independent of Submit and unlimited | SRC StudentDailyCard/VoiceExplainModal (no link, no cap) |
| N5 | Voice score not length-gated (12-word minimum only; 10 s → 55 observed by owner) | SRC `_shared/voiceScore.ts:42,160-188` |
| N10 | Code runner is `allUsers` invokable (secret header) though only functions call it | CFG IAM |
| N11 | Staging still runs the original (unfixed) Migration 45 | EARLIER staging audit |

## P4 — tech debt / documentation

| ID | Title |
|---|---|
| D1 | PDR says migrations "43–54 / 66 files": repo has `migration/` 66 files ending at **49** (three 49 files) and 139 `supabase/migrations` |
| D2 | Scheduler count: **12 production + 1 staging = 13** (both statements are right for a different scope) |
| D4 | IAM fixed (G05, verified 1 Oct) but `docs/PRODUCTION-ARCHITECTURE.md` still lists the default compute SA and old revisions |
| L4 | `/recruiter/:linkId` public page cannot be used (no way to create links; 0 links) |
| L7 | Current DB functions keep proof_uploads/trust_score compatibility branches |
| L8 | 22 orphan frontend files |
| N6 | Daily Lot not personalised (same oldest-unused page for everyone) — product decision |
| N7 | "Assigned Tasks … by colleges and admins" label wrong; finished items stay on the Floor |
| N18 | No PDR / original 15-step plan exists in the repo or on this laptop |

## Closed / not applicable

| ID | Result |
|---|---|
| D3 | Scheduler `timeZone = Asia/Kolkata` and cron values match the IST comments; **no 5.5 h shift** (CFG) |
| G01, G02, G05, G06, G10, G28 | Closed 1 Oct with evidence (`docs/closure/*`). G05 re-verified now: no Editor binding (CFG). G10 company login has since been deleted (see N1) |

## UNKNOWN — needs live or human evidence

| ID | Question | How to settle |
|---|---|---|
| U1 | Does production have any applied-migrations table? | read-only SQL (owner job) |
| U2 | Can a code-runner program reach the internet/metadata in practice? | staging probe |
| U3 | F8 exploit in practice | staging forking test |
| U4 | Identity Platform settings (email enumeration protection, password policy) | console read |
| U5 | Real monthly bill | billing export |
| U6 | Slow queries / recruiter search at 1k–10k candidates | Query Insights + staging seed |
| U7 | Whether the 1 `proofs/` object is personal data | owner look |
| U8 | Prod RLS/grants for tables not in the G01 audit | read-only SQL |
| U9 | Legal status of sending student data to DeepSeek | legal/privacy review |
