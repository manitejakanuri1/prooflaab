# Release certificate — ProofLabAI production, 1 Oct 2026

**Decision: A. PRODUCTION RELEASE CLOSURE: PASS — No unknown P0/P1 launch blockers remain.**

All six P1 blockers found by the closure pass were closed and proven on 1 Oct 2026. Each step was
verified before the next one started. Every remaining item is an ACCEPTED NON-BLOCKING RISK (section 5).

## 1. The six P1 blockers — all closed

| ID | Blocker | How it was closed | Evidence |
|---|---|---|---|
| G01 | Production DB invariants never audited | Owner ran the read-only audit; every line checked; 0 unexplained anomalies; corrected Migration 45 byte-identical | `docs/closure/G01-VERIFICATION.md` |
| G02 | Restore never proven | Point-in-time clone restored in 9 min 28 s; audit identical to production; clone deleted | `docs/closure/G02-VERIFICATION.md` |
| G10 | Company role untested | Verified TEST company; 33 access checks + live Home/Talent/Work/Jobs; admin/college/student pages closed | `docs/AUTHORIZATION-MATRIX.md` |
| G28 | Students could read college reports | Migration 49 (staging, then production after a backup); student refused, college still served | `docs/AUTHORIZATION-MATRIX.md`, `migration/49-*` |
| G06 | Staging robot could administer production logins | Role removed; production sign-in for all roles re-tested | `docs/FINAL-RELEASE-GAPS.md` |
| G05 | Compute account had Editor and ran 6 production services | Own least-privilege robot per service/job (api tested on a 0 % tag first); Editor removed from every account; full live re-test incl. a new voice recording | `docs/closure/G05-VERIFICATION.md` |

### Final re-check after all six (1 Oct 2026, ~03:40 UTC)

| Check | Result |
|---|---|
| Data invariants (19 read-only checks: voice, submissions, links, scratch values) | 0 failures |
| Student (live browser): Roadmap, new voice recording scored 72 server-verified, Build-Log, scratchpad Run | PASS |
| College / admin dashboards (live browser) | PASS / PASS |
| Company dashboard (live browser) | 12/12 |
| `authz_matrix_check.py` (4 roles) | 58/58 |
| `attack_surface_check.py` | 66/66 |
| `healthcheck.py` | 24/24 |
| Functions `/ready` | 40/40 |
| Bug finder (new robot) | 10/10 |
| Scheduler / reaper | all 13 jobs last result OK; `TRANSCRIPTION-REAP OK`, 0 stuck |
| Real data changed? | No: 4 students; the real students' only submission and recording are from 30 Sep |

## 2. What was proven earlier on 1 Oct (live)

| Check | Result |
|---|---|
| `scripts/healthcheck.py` | 24/24 |
| `attack_surface_check.py` (anonymous + forged tokens, every public endpoint) | 66/66 |
| `authz_matrix_check.py` (student, college, admin, company) | 58/58 (after Migration 49) |
| `company_dashboard_browser.mjs` (live) | 12/12: Home, Talent, Work, Jobs; admin/college/student pages closed |
| Bug finder | 10/10 |
| Functions `/ready` | 40/40 |
| Scheduler jobs | all 13 production jobs OK; reaper INFO only |
| Student journey | scratchpad Run + written Submit, sandbox Run/Submit "Passed", Roadmap, Build-Log voice 70/100 scored, server-verified, transcript shown |
| Admin | lands on `/admin/dashboard` (fixed today) |
| College | dashboard loads |
| Security headers | live; microphone allowed, camera blocked |
| CI gate | a failing test blocks deploy (proven on a temporary branch) |
| npm audit | 0 vulnerabilities |

## 3. Capacity

Database, last 7 days: CPU max 17.8 %, memory median 43.6 %, max 7 connections, 0 deadlocks, 0.3 GB.

Staging load test (staging is about half of production):

| Scenario | Users | p95 | Errors |
|---|---|---|---|
| Browse | 10 | 498 ms | 0 |
| Browse | 25 | 488 ms | 0 |
| Browse | 50 | 1,219 ms | 0 |
| Browse | 100 | 3,283 ms | 1 |
| Browse | 200 | 5,237 ms | 0.3 % (stopped) |
| Run button | 40 at once | 739 ms | 0 (105 runs/s) |
| Voice | 10 recordings | all scored in 45 s | 0 |

Verdict: safe for the current pilot. Single-zone database, so no high-availability claim.

## 4. Rollback and recovery

Proven: website release by version (both directions, live), functions revision back 13 s / forward 17 s,
voice queue pause/resume, reaper pause/resume, worker ingress off/on (all staging). Database restore: proven 1 Oct (G02): point-in-time clone in 9 min 28 s. Details: `docs/DISASTER-RECOVERY-RUNBOOK.md`.

Incident during this pass: an interrupted rollback command still ran; live served the previous
(Step 6) build for about 1 min 40 s on 30 Sep (21:25:33-21:26:39 and 21:27:48-21:28:23 UTC). Restored
and verified. Recorded as G29.

## 5. Accepted non-blocking risks

| ID | Risk | Reason |
|---|---|---|
| G03 | Single-zone database | Pilot size; DR runbook covers restore |
| G08 | Firebase admin SA has token-creator role | Google-managed; review with owner command 9 |
| G12 | Transcriber callable by any signed-in user | Mock interview needs it; 15 MB cap, 1 per instance, max 3 |
| G15 | GitHub secret scanning / branch protection not switched on | Blocked for Claude; owner command 3; CI gate already blocks untested deploys |
| G26 | 150 `no-explicit-any` lint errors in functions | Style only; lint not gating |
| G27 | Browser API key not restricted | Browser keys are public by design; owner command 4 |
| G30 | API errors name tables/functions | No data or secrets |
| G31 | Health check fails once on a brand-new track open | Passes on rerun |
| G32 | Above ~100 browsing users at once, p95 over 3 s | Raise limits when the pilot grows |
| G33 | 13 unused marking configs | No student data; optional clean-up |
| G34 | Broad table grants to anon/authenticated | RLS policies are the real control; revoke later |
| G35 | Old compute account keeps secret/bucket grants (no runtime uses it; Editor removed) | Only Cloud Build uses it; owners only; clean up later |
| G36 | Crawler not yet run under its new robot | Grants verified; next run Sunday, alert exists |
| G37 | Functions `/ready` credential self-check shows a harmless 404 | Wrong diagnostic path since 30 Sep; real calls work |

Everything else in `docs/FINAL-RELEASE-GAPS.md` is FIXED or VERIFIED.

## 6. Live versions certified

| Part | Version |
|---|---|
| Website | Hosting `79a3164cfe001a3b`, bundle `index-CWe_5Kb3.js` |
| Functions | `prooflab-functions-00053-c7m` (40 loaded), runs as `prooflab-rt-functions` |
| API | `prooflab-api-00004-rom`, `prooflab-rt-api` |
| Auth bridge | `prooflab-auth-bridge-00012-vdh`, `prooflab-rt-authbridge` |
| Files | `prooflab-files-00014-r2w`, `prooflab-rt-files` |
| Accounts | `prooflab-accounts-00003-rgf`, `prooflab-rt-accounts` |
| Transcriber | `prooflab-transcriber-00003-v7l`, `prooflab-rt-transcriber` |
| Code runner | `prooflab-code-runner-00001-rpr` |
| Worker | `prooflab-transcription-worker-00001-sl6` |
| Database | `prooflab-db`, Postgres 17, migrations up to 49 applied (49 on 1 Oct, after a backup) |

## 7. Optional follow-ups (not blockers)

- Owner commands 3 (GitHub security settings), 4 (restrict the browser API key), 9 (Firebase admin role).
- G35: remove the old compute account's leftover grants after confirming Cloud Build does not need them.
- Watch the crawler's first run under its new robot (Sunday 08:10 IST).
