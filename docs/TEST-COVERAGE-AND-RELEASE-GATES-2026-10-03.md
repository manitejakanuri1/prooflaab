# Test coverage and release gates — 3 Oct 2026

## What exists (SRC now)

| Suite | Files | Run in CI? | Last result |
|---|---|---|---|
| Frontend unit (`node --test src/lib/*.test.ts`) | 10 | ✔ | 92/92 (EARLIER 2 Oct) |
| Typecheck (`tsconfig.app.json`, `strict: false`) | — | ✔ | clean (EARLIER) |
| ESLint | — | ✖ | ~150 errors in functions, 1 in StudentProgressPage (pre-existing) |
| Deno tests | 11 files | partly: only `_shared/` + `transcription-reap/` | 93/93 (EARLIER) |
| auth-bridge / files-service Deno tests | in the 11 | ✖ | not run in CI |
| Python (`transcription-worker/test_server.py`) | 1 | ✖ | 27 passed (EARLIER 29 Sep) |
| Code runner tests | 0 | — | none exist |
| Database tests | migration self-checks (`do $$`) only | ✖ | rehearsals on staging |
| Browser scripts (Playwright, `scripts/dev-tools/*.mjs`) | 15 | ✖ (manual) | various (EARLIER) |
| `healthcheck.py` (24 checks) | 1 | manual | **5/6 on 2 Oct** — stops early, smoke student missing (N1) |
| `attack_surface_check.py` (66) | 1 | manual | **66/66 RUN now** |
| `authz_matrix_check.py` | 1 | manual | 58/58 EARLIER; cannot run fully today (N1) |
| Bug finder (scheduled) | job | scheduled 6×/day | failing student steps since 2 Oct (N1) |
| Load test | staging script | manual | EARLIER 1 Oct (≤200 concurrent browse) |

## False-positive risks found in earlier testing (honest list)

| Risk | Where it applied |
|---|---|
| Fake/minted JWT instead of real Google sign-in | Step 6 harness and staging scripts (stated at the time) |
| Simulated network/servers in browser tests | VoiceExplainModal rounds 1–7 |
| Helper tests presented next to E2E | unit tests of voiceLifecycle vs real pipeline (kept separate in reports) |
| Production claims based on staging | load test (staging, half size) — labelled as such |
| Tests that never hit the target branch | authz checks that expected 403 but got 204/0 rows (fixed 2 Oct) |

## Release gates (proposed, none executed now)

1. CI: all Deno tests (incl. bridge/files), Python worker tests, ESLint (no new errors), typecheck, unit — on the **artifact that deploys** (F16).
2. Protected test identities exist (student, college, company, admin) — N1.
3. Staging E2E with real sign-in: student write → required voice → Build-log; company post → student submit → company review (L1); TPO import → squads.
4. `llm_usage` and `rate_limits` rows appear for a test AI call and a test code run (F3).
5. Negative security suite 66/66 + authz matrix all roles.
6. Code runner isolation tests: forking program, memory bomb, egress probe (F8/F9).
7. Healthcheck 24/24 and bug finder green on production after deploy.
