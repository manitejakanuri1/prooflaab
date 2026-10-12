# Integration flows (13 Oct 2026)

LIVE = really run against deployed staging or production. OFFLINE = real code with stand-ins (unit, fault injection,
PGlite PostgreSQL 16). STATIC = source analysis. Nothing signed-in has run: the GitHub environment `staging-e2e`
does not exist and staging still serves `59235dd`.

| Flow | Step | Evidence | Result |
|---|---|---|---|
| A. Student import | CSV parse, branch pick, duplicates, managed login, college, squads at import | S39 PGlite: import after removal fills the vacancy; UI contract of the Branch dropdown | OFFLINE PASS |
| | real import of a disposable student -> login -> dashboard | needs `staging-e2e` + disposable college fixture | **BLOCKED** |
| B. Account deletion | self-deletion, college/admin removal, outbox retry, consent, file purge rules | S36-S38 PGlite + accounts tests; TEJA 110 lifecycle 20/20 | OFFLINE PASS |
| | Console deletion -> sync -> access cut; unmapped never cut; dry run reachable | S40 `test_sync_faults`, `test_sync_unmapped`, `identityFaults` (57) | OFFLINE PASS (2 bugs fixed) |
| | real disposable deletion, old session refused, repeated deletion safe | needs isolated staging Identity tenant + disposable pool + 110 deployed | **BLOCKED** |
| C. Squads | fill to 11, locked/limit/concurrency, history, Assign/Rebalance | S39: PGlite 30 + real PostgreSQL concurrency 4; staging rolled-back E2E; production 108 applied | LIVE PASS (DB) |
| | nightly job | production `nightly-squads` ok every night; first run with 108: 05:35 IST 13 Oct (check `colleges_failed: 0`) | LIVE PASS (job runs) |
| | standings, scoring, leaderboard after a week | production `weekly-seasons` ok 11 Oct; signed-in view of results | job LIVE PASS; view **BLOCKED** |
| D. Crawling | scheduled crawler job | `prooflab-crawler-weekly` enabled (production); no controlled-fixture run here | **NOT_TESTED** |
| E. Roadmap | weekly plan job | production `weekly-plan` ok (8 students, 10 topics) | LIVE PASS (job runs) |
| | evidence -> gap -> recommendations -> progress, signed in | needs student fixture | **BLOCKED** |
| F. AI assessments | daily Lots creation | production `daily-lots` ok (20 created) | LIVE PASS (job runs) |
| | coding run/submit, written, voice -> score -> proof -> recruiter view | recipes `student-written-submit`, `company-voice-*`; need fixtures | **BLOCKED** |
| Every frontend/server call connected to an existing, permitted backend object | 208 endpoints | `sidhu_s41_contract_drift` | STATIC PASS (2 + 2 fixed by 111) |
| Every gateway address refuses a signed-out / forged caller | 68 probes | `sidhu_s40_anon_api` on staging | LIVE PASS (signed-out) |
| Scheduler -> scheduled-job -> RPC | 7 jobs, all mapped RPCs exist and are server-only | production logs, 8 days, 0 failures | LIVE PASS (production); staging **BLOCKED** (jobs absent) |
