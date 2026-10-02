# ProofLabAI — full pre-deployment audit (3 Oct 2026)

**Overall status: READY FOR RELEASE-CANDIDATE REMEDIATION** (not ready for a broader rollout; the current
live pilot keeps working, but 5 P1 blockers are open).

Read-only. No file outside `docs/` was changed. Nothing was deployed, migrated, deleted, merged or
committed. The only production access was reads: config `describe`/`list`, row counts through the
API, one public-key comparison, and one re-run of the negative security test (anonymous and forged
requests only).

Companion files (all `docs/*-2026-10-03.md`, uncommitted):
- `RELEASE-BLOCKER-REGISTER` (master list)
- `LEGACY-RETIREMENT-MAP`
- `END-TO-END-FLOW-MATRIX`
- `STAGING-PRODUCTION-STATUS-MATRIX`
- `SECURITY-THREAT-AND-PERMISSION-AUDIT`
- `TEST-COVERAGE-AND-RELEASE-GATES`
- `CLEANUP-AND-COMPLETION-ORDER`
- `CURRENT-AND-TARGET-ARCHITECTURE`
- `DATABASE-MIGRATION-AND-SCHEMA-DRIFT`
- `INFRASTRUCTURE-IAM-SECRETS-AUDIT`
- `PERFORMANCE-CAPACITY-COST-AUDIT`

## Part 1 — Source of truth

| Item | Value |
|---|---|
| Path | `C:\Users\manit\Downloads\prooflabai-mvp\prooflabai-mvp` |
| Remote | `prooflaab` = github.com/manitejakanuri1/prooflaab (no `origin` remote configured here) |
| Branch / HEAD | `work/step6j-release-gates` @ `d736e4dd95925aeaa017200d06033bf0d92c77fa` |
| main / work branch on GitHub | both `d736e4d`; identical; 0 unpushed |
| Tags | `pre-production-hardening-v1` (older) |
| git status | tracked clean; untracked: 7 old audit reports, `authz_matrix_results.json`, `__pycache__`, `voice-playback-fail.png`, `LEGACY-SYSTEM-AUDIT-2026-10-02.md`, and these new files |
| Live website | `index-DOGmJNPd.js` = build of `d736e4d` (CI run success, 2 Oct) |
| Live functions | `00053-c7m`, image `b101fcdc…`, `/ready` 40/40 (RUN now); staging uses the same image |

## Part 2 — Repository map (concise)

- **Frontend:** `src/` (React 18, TS 5, Vite 7, React Router 7, TanStack Query, Tailwind/shadcn; 288 TS files, 263 reachable).
  - Pages: `src/pages`.
  - Role areas: `src/components/dashboard/{student,college,admin,startup,recruiter,season}`.
  - Backend client: `src/integrations/{supabase,google}`.
- **Backend (Deno):** `functions-service/main.ts` (router, 40 SLUGS), `supabase/functions/*` (40 functions + `_shared`), `auth-bridge/`, `files-service/`.
- **Backend (Python):** `accounts/`, `transcriber/` (faster-whisper), `transcription-worker/`, `code-runner/`, `crawler/`.
- **Node:** `bug-finder/` (Playwright job).
- **Data:** `supabase/migrations/` (139), `migration/` (66, incl. Step 6 scripts), `src/integrations/supabase/types.ts`.
- **Infra/ops:** `.github/workflows/{deploy,crawl}.yml`, `scripts/` (deploy-hosting, healthcheck, setup_monitoring, dev-tools), runbooks in `docs/`.

## Part 3 — Documents and contradictions

| Document | Contradiction with code/config |
|---|---|
| `ProofLabAI-PDR-Master-Prompt.md` | **not found** anywhere on this laptop or in the repo (N18) |
| `ProofLabAI-Architecture-Flaws-and-Fixes.md` (Downloads) | F1–F21 audited below; D1–D5 below |
| `docs/PRODUCTION-ARCHITECTURE.md` | still lists the default compute SA and old revisions (D4) |
| `CLAUDE.md` | "17 tracks, 167 topics" vs 41 tracks / 817 topics later in the same file; bug-finder notes say "not scheduled" / "3×/day" vs live 5×/day + deep daily; "revision 00052-g84" vs live 00053-c7m; "No upload proof" rule vs legacy code (D5) |
| `docs/PROOFLABAI-COMPLETE-ARCHITECTURE-AND-STATUS.md` | Step 6K snapshot (26 Sep): async voice "STAGING ONLY" (now production), 45 "staging-only" (now production) |
| `docs/RELEASE-CERTIFICATE-2026-10-01.md` | says PASS; still true for its six blockers, but it predates F3/L1 evidence and the test-login deletions (N1) |
| `docs/AUTHORIZATION-MATRIX.md` | company rows verified 1–2 Oct; the company login no longer exists |

## Part 4 — The original 15-step plan

**SOURCE DEFINITION NOT FOUND.** No 15-step plan exists in the repo, the docs, or this laptop.

What git and the docs do show:
- Product "Stages" 1–90 (Jul–Sep 2026).
- The move to Google Cloud as Phases 4–7 (12–13 Sep).
- An engagement numbered **Step 1–6**:
  - Step 5 = Cloud Tasks smoke worker (`ea9fc53`).
  - Step 6 = async voice (6A–6K plus closure).
  - Steps 1–4 are not individually documented.
- **"Step 7"** is referenced as separate AI-queue work: NOT STARTED in this repo.

Classification:

| Step | Status |
|---|---|
| Step 5 | COMPLETE (staging only, by design) |
| Step 6 | COMPLETE in production (with F12/N4/N5 product gaps) |
| Step 7 | NOT STARTED |
| Steps 1–4 | UNKNOWN |

## Part 5 — Intended product model vs actual

| Role | Intended | Actual | Gap |
|---|---|---|---|
| Student | Floor → Build-log → Squad → Profile; required ~60 s voice after Submit; Build-log links work + voice + feedback | Destinations: Daily Card (Floor) + task list, Build-Log (Entries/Skills/Cosigns/History/Progress/Badges), Squad, Profile (9 tabs). Voice optional, separate, unlimited. Build-log Entries = legacy uploads + voice card; work and voice not linked | PARTIAL |
| TPO | Home → Students → Squads → Insights | Matches the sidebar. Legacy trust field in profile | mostly matches |
| Recruiter | Home → Talent → Shortlist → Lots | Company dashboard Home / Talent / Work / Jobs; recruiter role redirects here | naming differs; submissions broken (L1) |
| Company/startup | ? | **Same role as recruiter** (`startup`; `/startup/*` and `/recruiter/dashboard` redirect to `/company/dashboard`) | merged by design (CLAUDE.md) |
| Admin | current operations only | current + legacy Proof Review, Trust & XP, `/review-proofs` | L2 |

## Parts 6–7 — Routes and journeys
Routes: `docs/LEGACY-SYSTEM-AUDIT-2026-10-02.md` §3 and §5 (unchanged at HEAD). Journeys: `END-TO-END-FLOW-MATRIX-2026-10-03.md`.

## Parts 8–10 — Legacy and orphans
`LEGACY-RETIREMENT-MAP-2026-10-03.md`.

**Totals:**
- 12 legacy tables + 1 column (all 0 rows).
- 30 removable files.
- 8 UI removals.
- 22 replace-first items.
- 2 decisions.
- 9 server functions.
- 4 legacy RPCs.

## Part 11 — F1–F21

| F | Claim | Status | Severity | Evidence (short) |
|---|---|---|---|---|
| F1 | shared signing secret | CONFIRMED_OPEN (prod) | P1 | HS256 everywhere; 10 identities read the secret |
| F2 | service_role everywhere | CONFIRMED_OPEN | P2 | `backend.ts` always mints service_role |
| F3 | rate limit/AI usage/cache/audit off | **CONFIRMED_OPEN, PRODUCTION_VERIFIED** | P1 | env lacks `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; `llm_usage` last row 11 Sep; `rate_limits` 0 |
| F4 | email pre-registration takeover | CONFIRMED_OPEN (code) | P1 | link without verification; browser-only gate |
| F5 | browser roles | PARTIALLY_CONFIRMED | P3 | self-claim policy; approval gates |
| F6 | accounts sync deletion | CONFIRMED_OPEN | P2 | no threshold; 4 removals 2 Oct |
| F7 | shared scheduler password | CONFIRMED_OPEN | P3 | static header; `!==` compare |
| F8 | runner leftover processes | CONFIRMED_OPEN (code), NEEDS_LIVE_CHECK | P1 | `killpg` only on timeout |
| F9 | runner memory/egress | CONFIRMED_OPEN (config) | P2 | no RLIMIT_AS; no egress control |
| F10 | public runner fallbacks | CONFIRMED_OPEN | P2 | `runCode` falls back for graded paths |
| F11 | mutable scored evidence | CONFIRMED_OPEN (code) | P2 | `x-upsert`, DELETE allowed |
| F12 | old voice path | CONFIRMED_OPEN | P2 | students score own browser rows; 46 on hold |
| F13 | Whisper base / English | CONFIRMED_OPEN | P3 | `language="en"`, base model |
| F14 | prompt injection / no timeouts | CONFIRMED_OPEN | P2 | single user message; no AbortSignal |
| F15 | PII to AI providers | CONFIRMED (legal review needed) | P2 | DeepSeek only in prod (Gemini/Kimi keys absent) |
| F16 | CI/deploy mismatch | CONFIRMED_OPEN | P2 | Node 22 test vs Node 20 rebuild; partial test suites |
| F17 | schema source of truth | CONFIRMED_OPEN | P2 | two folders, three 49s, no applied record |
| F18 | no IaC | CONFIRMED_OPEN | P3 | none |
| F19 | non-transactional writes | CONFIRMED_OPEN (mitigated) | P3 | createUser then inserts |
| F20 | fire-and-forget logging | CONFIRMED_OPEN | P3 | `void logUsage` |
| F21 | capacity | PARTIALLY_CONFIRMED | P3 | 16/50 connections; staging-only load evidence |

## Part 12 — D1–D5

| D | Result |
|---|---|
| D1 | CONFIRMED doc error: highest migration **49** (three files); `migration/` 66 files; `supabase/migrations/` 139 |
| D2 | 12 production + 1 staging scheduler jobs = 13 total |
| D3 | **NOT APPLICABLE:** scheduler `timeZone=Asia/Kolkata`, crons match IST comments; no 5.5 h shift |
| D4 | IAM fixed (no Editor, verified now); doc `PRODUCTION-ARCHITECTURE.md` stale |
| D5 | CONFIRMED: `proofs/` storage object (1), UploadProofModal, proof_uploads, 9 functions and many consumers remain |

## Parts 13–14 — Auth and authorization
`SECURITY-THREAT-AND-PERMISSION-AUDIT-2026-10-03.md`. Negative suite 66/66 (RUN now). Role matrix
58/58 (EARLIER 2 Oct). Student and company re-tests are blocked today (test logins deleted, N1).

## Parts 15–17 — Database, legacy tables, migrations 41–47
`DATABASE-MIGRATION-AND-SCHEMA-DRIFT-2026-10-03.md`. Migration 46 stays unapplied.

## Part 18 — Voice
- **Pipeline:** WORKS_END_TO_END in production (EARLIER 1 Oct, scored 72; DATA 10 scored rows).
- **Lifecycle:** browser lifecycle hardened in 7 review rounds (EARLIER, simulated servers).
- **Open:**
  - F11 (mutable evidence);
  - F12 (self-reported path);
  - F13 (accent);
  - N4 (not required after Submit; unlimited recordings);
  - N5 (no length gating);
  - N2 (removed students' audio kept).

## Part 19 — Code runner
- **Good:** unprivileged user, CPU/file/process limits, fresh dir, concurrency 1, no-role SA, secret header.
- **Open:**
  - F8 (leftover processes);
  - F9 (no memory limit, egress open, metadata reachable but the SA has no roles);
  - F10 (public fallbacks);
  - N10 (public invoker).
- **Tests:** none exist for the runner.

## Part 20 — Resume / onboarding
- **Flow:** CODE_EXISTS. Exercised by the deep bug finder (EARLIER 30 Sep, 6/6).
- **Personal data:** goes to DeepSeek (F15).
- **AI calls:** not logged (F3).
- **Malicious, oversized or corrupt PDF:** NOT TESTED.

## Parts 21–22 — AI inventory and integrity

| Provider | Used for | Active in prod | Timeout | Logged |
|---|---|---|---|---|
| DeepSeek `deepseek-chat` | Lot writing, written grading, voice scoring, resume, interview, chatbot, explainers | yes | **none** | **no (F3)** |
| Gemini `gemini-flash-latest` | fallback | no key | none | — |
| Kimi `kimi-k2` | fallback | no key | none | — |
| Whisper base (own) | speech → text | yes | Cloud Run 120 s | n/a |

- AI output validation exists for voice scores (0–100 numeric gate) and rubric clamping.
- Prompt and data separation is missing (F14).

## Part 23 — Storage
`INFRASTRUCTURE-IAM-SECRETS-AUDIT-2026-10-03.md` §4.
- Cross-user reads were denied (EARLIER).
- Orphan files remain (N2).

## Part 24 — Scheduler
Infra audit §3. All jobs ran OK on 3 Oct.

## Part 25 — Squad engine
- `form_squads`: per section, at most 11 per squad, `k := n/11`, fills existing squads first. SRC.
- `run_squad_week`, `advance_season`, `run_all_seasons`: present (SRC).
- Live squad behaviour NOT TESTED in this audit.
- Members screen hides teammate names (N3).

## Parts 26–28 — Recruiter / company
- **Proof profile** draws on current evidence **and** legacy proof_uploads/trust, and counts browser-sourced voice (F12, L7).
- **Search query:** correlated subqueries; scale UNKNOWN (U6).
- **Company submissions:** BROKEN (L1, P1).

## Part 29 — Admin
- **Current:** People, Flagged, Assign Tasks, Content Library, Token Usage (empty due to F3), Security Events, Student Trace, Bug Finder, Settings.
- **Legacy:** Proof Review, Trust & XP, `/review-proofs`.
- **Mixed:** Overview, Analytics, Task Oversight.

## Parts 30–32 — Threats, secrets, IAM
See the security and infra audits.
- No Editor anywhere.
- The compute SA still reads every secret (N14).
- `GOOGLE_API_KEY` env equals the public browser key.

## Parts 33–35 — Cloud Run, network, connections
See the infra and performance audits.
- All services have ingress `all`.
- The worker is the only one that is private.
- 16/50 DB connections.

## Parts 36–37 — Integrity and scoring

| Score | Computed by | Stored | Client can write? |
|---|---|---|---|
| Written/code task score | submit-written-task / submit-sandbox-task → `record_task_submission` | task_submissions | no |
| Communication (voice) | voice-score (server for server rows; **student for browser rows, F12**) → `complete_voice_scoring` | voice_explanations | no direct write; can trigger scoring of own browser row |
| Resume / ATS | resume-* functions | resume_* tables | no (protected columns) |
| XP | DB functions/triggers | xp_logs | no |
| Squad points | `run_squad_week` | squad/student_weekly_scores | no |
| Trust score | legacy trust-compute (writes) + TrustXPModeration (admin writes) | student_profiles.trust_score | admin only; always 0 |

## Part 38 — Notifications
- Email via Resend (`send-onboarding-email`, invoked by the student/college create functions).
- In-app `notifications` table.
- No WhatsApp.
- Weekly-progress idempotency (migration 40) was prepared on 24 Sep; its production status is UNKNOWN.
- Retry/duplicate behaviour for email: NOT TESTED.

## Parts 39–40 — Logging and observability
- Request logs are structured.
- `security_events` is written (645 rows).
- `audit_logs` is written.
- **AI usage is not written (F3)**, and nothing alerts on that.
- 27 alerts and 8 uptime checks.
- Missing alerts: AI logging silent, mass student removal, rate limiter inactive.

## Part 41 — Rate limiting
`check_rate_limit` exists in code and in the DB, but **never executes** in production (F3; `rate_limits` 0 rows).

## Part 42 — Cost
- OBSERVED: budget alert configured.
- UNKNOWN: actual AI spend (logging off), actual bill (U5).

## Part 43 — Load
- Staging only, ≤200 concurrent browsing (EARLIER).
- Production: NOT LOAD TESTED.

## Parts 44–46 — CI, CD, supply chain
- **CI:** frontend unit + typecheck + partial Deno + build.
- **CD:** site rebuilt on Node 20 (F16); backend and DB deployed by hand.
- **npm audit:** 0 vulnerabilities (RUN now).
- **Not pinned:**
  - Docker bases use unpinned tags (`debian:bookworm-slim`, `postgres:17`, `postgrest:v16.3`);
  - GitHub Actions are pinned to major tags, not SHAs.

## Part 47 — Backup / DR
- Daily backups + 7-day PITR (CFG).
- **Restore tested** (G02, 9 min 28 s).
- Revision rollback tested (EARLIER).
- Website rollback tested (EARLIER).
- No storage lifecycle.

## Part 48 — Privacy (no legal claims)

| Data | Where |
|---|---|
| Names, emails, phone, roll number, college | Cloud SQL |
| Resumes and voice audio | private bucket, **kept after removal** (N2) |
| Transcripts and answers | Cloud SQL, and sent to DeepSeek (F15) |
| Step trail | `app_events`, 90 days |

Legal review needed for:
- consent wording;
- overseas AI processing;
- retention after removal.

## Part 49 — Frontend state
- The recording window is heavily hardened (7 rounds).
- Other screens' loading, error and multi-tab behaviour: NOT TESTED systematically.

## Part 50 — Product simplicity
- **Student:** exposes backend-shaped tabs (Cosigns, History, Skills, Badges) and legacy items.
- **Admin:** exposes the legacy verification system.
- **TPO:** matches the model.

## Parts 51–53 — Evidence and cross-role
- Earlier claims are labelled EARLIER, never as independent proof.
- **Cross-role:** student → TPO works; student → company is broken.

## Part 54 — Status matrix
`STAGING-PRODUCTION-STATUS-MATRIX-2026-10-03.md`.

## Parts 55–56 — Architecture
`CURRENT-AND-TARGET-ARCHITECTURE-2026-10-03.md`.

## Part 65 — Go / no-go

| Question | Answer |
|---|---|
| PRODUCT: intended flow consistently implemented? | **PARTIAL** |
| LEGACY: old architecture retired? | **NO** |
| AUTH safe enough? | **PARTIAL** (F1, F4) |
| AUTHORIZATION boundaries proven? | **PARTIAL** (all roles 2 Oct; student/company not re-provable today) |
| DATABASE model clear? | **PARTIAL** (F17, legacy objects) |
| CODE RUNNER isolation adequate? | **PARTIAL** (F8–F10) |
| VOICE end-to-end verified? | **PARTIAL** (pipeline yes; required-after-submit and immutability no) |
| AI acceptable? | **PARTIAL** (F3, F14, F15) |
| SECURITY: P0/P1 open? | **YES** (P1: F1, F3, F4, F8) |
| STAGING: all release-critical flows passed? | **NO** (company submission; required voice) |
| PRODUCTION: intended architecture deployed? | **PARTIAL** |
| PERFORMANCE demonstrated? | **NO** (staging only, ≤200) |
| COST controls functioning? | **NO** (F3) |
| OBSERVABILITY detects major failures? | **PARTIAL** |
| BACKUP credible and tested? | **YES** (restore 9 min 28 s; rollbacks drilled) |

## Part 66 — Overall
**READY FOR RELEASE-CANDIDATE REMEDIATION.** The 1 Oct closure certificate covered the six blockers it listed,
and those remain closed. This wider audit found 5 new P1 items (F1, F3, F4, F8, L1) that must close before a
broader rollout. Remediation order: `CLEANUP-AND-COMPLETION-ORDER-2026-10-03.md`.
