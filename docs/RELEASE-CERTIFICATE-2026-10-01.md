# Release certificate — ProofLabAI production, 1 Oct 2026

**Decision: PRODUCTION RELEASE CLOSURE: FAIL**

Production works and was proven end to end today. The closure still fails because three P1 items could
not be closed or proven by Claude (closed 1 Oct: G01, G02, G10 PASS — see `docs/closure/G01-VERIFICATION.md`, `G02-VERIFICATION.md`, `docs/AUTHORIZATION-MATRIX.md`). Each needs one owner action, written out in
`docs/closure/OWNER-COMMANDS.md`. The rule for this pass: no PASS because "most things work".

## 1. Blockers (P1, must be closed or accepted by the owner)

| ID | Blocker | Why it is P1 | Owner command |
|---|---|---|---|
| G28 | Students can read their college's reports (`tpo_placement_report` lists classmates and hiring companies) | Privacy. 0 hires recorded today, so nothing exposed yet | 6 (Migration 49, rehearsed on staging) |
| G05 | Default compute account has project Editor and runs 6 production services | One leaked service could change the whole project | 8 (per-service, Editor last) |
| G06 | Staging account can administer production logins | Staging mistake could touch real accounts | 7 |

## 2. What was proven today (live)

| Check | Result |
|---|---|
| `scripts/healthcheck.py` | 24/24 |
| `attack_surface_check.py` (anonymous + forged tokens, every public endpoint) | 66/66 |
| `authz_matrix_check.py` (student, college, admin, company) | 52/53: only failure is G28 |
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

Everything else in `docs/FINAL-RELEASE-GAPS.md` is FIXED or VERIFIED.

## 6. Live versions certified

| Part | Version |
|---|---|
| Website | Hosting `79a3164cfe001a3b`, bundle `index-CWe_5Kb3.js` |
| Functions | `prooflab-functions-00052-g84` (40 loaded) |
| API | `prooflab-api-00003-n6c` |
| Auth bridge | `prooflab-auth-bridge-00011-njh` |
| Files | `prooflab-files-00013-jsz` |
| Accounts | `prooflab-accounts-00002-bc9` |
| Transcriber | `prooflab-transcriber-00002-8lk` |
| Code runner | `prooflab-code-runner-00001-rpr` |
| Worker | `prooflab-transcription-worker-00001-sl6` |
| Database | `prooflab-db`, Postgres 17, migrations up to 48 applied (49 prepared, not applied) |

## 7. How this becomes PASS

1. Run owner commands 6, 7 and 8 (commands 1, 2, 5 done: G01, G02, G10 PASS) in `docs/closure/OWNER-COMMANDS.md`.
2. Paste the outputs back (`docs/closure/prod-audit-output.txt`, `restore-drill-output.txt`).
3. Claude checks the outputs, re-runs `authz_matrix_check.py` (expect 25/25 with company) and `healthcheck.py`,
   and updates this certificate to PASS if nothing new is found.
