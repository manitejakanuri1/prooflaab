# ProofLab — release candidate, pre-production report

Date: 3 Oct 2026 · Branch: `work/stabilization` (31 commits on top of `main` = `d736e4d`) · Rollback tag: `stabilization-baseline-2026-10-03`

**Status: STAGING PASS. PRODUCTION IS UNTOUCHED AND ON HOLD.**
Nothing in this report is live. Not merged to `main`, no production migration, no production deploy, no production setting changed. Going live needs the owner's yes (see `PRODUCTION-ROLLOUT-CHECKLIST.md`).

This is **not** a "production ready" certificate. It says what was built, what was proven on staging, and what is still open.

---

## 1. In one page

| Area | Before | Now (on staging) | Proof |
|---|---|---|---|
| Who can sign login tokens | 7 services shared one key; any of them could forge any user | Only the login bridge can sign. Others only check. | 34/34 |
| One student reaching another's data through a server function | Never tested | Every function swept as another college's student, a company, and nobody | 75/75 |
| Spoken explanation | Optional, tied to a task, deletable, scored without looking at the work | Belongs to one submission, retries kept, cannot be edited or deleted, scored against the actual submitted work | 14/14 + 11/11 (real audio) |
| Student import | Three separate writes; a failure left half a student | All-or-nothing, repeatable | 7/7 |
| Nightly Lot job | One odd profile stopped Lots for everyone | Each student handled alone; failures counted and logged | 15,000 Lots in 20 s |
| Company screens | Read retired "proof" tables: showed nothing | Show real submissions and the bound explanation | browser 6/6 |
| Trust score, proof upload, cosigns, old proof review | Still in screens, 9 server functions, 11 tables | Gone from screens and code; tables dropped on staging after archiving | full regression green |
| Which migrations a database has | Notes | A ledger in the database; changed files refused | proven |
| Build | Site built twice | The tested build is the one published | CI green on the branch |
| Scale | Unproven | 15,000 synthetic students: every screen under 1 s; 200 active users at once with no errors | see §5 |

Local tests: unit 95 · server functions 103 · bridge 15 · files 16 · Python token tests · worker 27 · runner 22 (CI). Staging release gate: **18 of 18 PASS** (`scripts/dev-tools/staging_release_gate.sh`).

---

## 2. What changed, by wave

| Wave | What | Migrations | Status |
|---|---|---|---|
| 1 | AI usage/rate-limit/cache/security logging works again; AI timeouts; resume answer keys hidden; code never sent to public runners in production; account sync suspends instead of deleting; safer linking and reset links | 50, 51, 55 | STAGING_PASS |
| 2 | 24 dead files removed | — | STAGING_PASS |
| 3 | Code runner hardened (leftover processes, memory, no internet); one coding engine with a test-quality gate | 52 | STAGING_PASS |
| 4 | Lot wording contract; Lots written ahead of time | 53 | STAGING_PASS |
| 5 | Company sees real work; company Lots with a real checker; every task has a checker; college material stays in the college; Build-log, Admin, TPO, Squads on current data; teammate names | 54, 56, 57, 57b, 58, 59, 60 | STAGING_PASS |
| 6 | Voice: bound to the submission, history, immutable, scored against the submitted work | 61 | STAGING_PASS (Whisper benchmark BLOCKED) |
| 7 | Only the bridge signs tokens; cross-account sweep; import in one transaction | 62 | STAGING_PASS (F2 conversion IN_PROGRESS) |
| 8 | Portfolio on current evidence; proof-era screens, 9 functions and DB readers removed | 63, 64, 65 | STAGING_PASS |
| 9 | Migration ledger; CI secret scan, migration check, build once; infrastructure snapshot | 67 | STAGING_PASS (deploy hand-off unproven until first `main` run) |
| 10 | Proof-era tables/functions/column dropped after archiving | 66 | STAGING_PASS (rehearsal) |
| 11 | One release gate that runs every proof | — | STAGING_PASS |
| 12 | 15,000-student dataset, screen timings, nightly jobs, progressive load, cost | 68 | STAGING_PASS |

Full detail per item, with rollback for each: `docs/STABILIZATION-EXECUTION-REGISTER.md`.

---

## 3. Security results

| Check | Result |
|---|---|
| Old-style (shared key) tokens, user and service | Refused by API, functions, files, accounts, transcriber |
| Forged tokens (other key, "none", key-confusion) | Refused everywhere |
| Service tokens | Issued only to 3 named staging service accounts presenting their Google identity; a real Google user is refused |
| Services still holding the shared signing key on staging | 0 (production today: 7) |
| Cross-account calls to all 32 functions | All refused; no AI spend; victim's rows unchanged |
| Retired functions | All 9 answer 404 |
| Voice evidence | Cannot be moved, re-pointed, rewritten, deleted; audio is write-once |
| College material | Never reaches another college's student |
| Secrets in the repository | 0 findings (one old public key of the deleted Supabase project was replaced by a placeholder) |

One thing to know: during testing a failed command printed the first characters of the **staging** signing-key file into the work session. That part is the standard file header and the start of the public number — not secret. The staging key was rotated anyway and the old version destroyed.

---

## 4. Findings discovered while doing this work

| # | Finding | Severity | State |
|---|---|---|---|
| A | **Cloud Run CPU quota is 20 vCPU for the whole project and region — staging and production share it.** Production's own configured maximums add up to 35 vCPU (plus a worker with no maximum). My staging load test used the quota up; staging could not start new instances for about 8 minutes. Production had no errors (checked). | **P1 before scale** | OPEN — owner must request a quota increase; long term, move staging to its own project |
| B | Nightly Lot job: one bad profile stopped Lots for every student | P1 | FIXED (68, staging) |
| C | Student removal backup did not include the student's submissions | P2 | FIXED (65, staging) |
| D | Company "verified" count and portfolio read tables nobody writes | P2 | FIXED (63, 64) |
| E | Run-code rate limit (120/hour per student) now really works — the old load script, which reused one student, is correctly blocked | info | script updated |
| F | Voice queue retries only 3 times in about 40 s; if the transcriber cannot start (as in A) recordings fail for good | P2 | staging queue now 8 tries over about 8 minutes; production queue unchanged (needs approval) |
| G | `task_assignments` and `task_applications` looked dead (0 rows) but have live readers | info | kept |
| H | Monthly budget is ₹3,000; projected cost at 15,000 daily-active students is far above it (see §6) | decision | OPEN — owner |

---

## 5. Scale results (staging, smallest database tier, half of production's instances)

**Dataset:** 15,000 students, 10 colleges, 1,320 squads, 105,000 Lots, 64,572 submissions, 17,754 recordings (database 191 MB). Synthetic, removable (`staging_loadset_remove.sql`).

| Test | Result |
|---|---|
| 23 screen queries (college, student, admin, company) | all 200–830 ms (limit 1,500 ms) |
| Daily Lots for 15,000 students | 15,000 created in 20 s; second run creates 0 |
| Squads / weekly seasons / prune jobs | under 1 s each |
| Students browsing at once (each a different student, about 1 call per second) | 25–200 users: 0 errors, p95 0.3–0.6 s. 400 users: p95 8 s, 0.7% timeouts — **staging's limit is about 150 calls per second** |
| Run button (40 students at once) | 42 runs per second, p95 1.1 s, 0 errors |
| 30 recordings at once | all scored in 73 s (about 24 per minute with 2 transcriber instances) |

Reading the numbers: a real student makes roughly 1 call every 30–40 seconds, not 1 per second, so 150 calls per second is on the order of several thousand students active in the same minute. Production has about twice staging's capacity **if finding A is fixed**. This is an estimate, not a measurement of production.

Not tested: 500+ simultaneous submissions with AI grading (cost), real 60-second recordings at volume, production itself (forbidden).

---

## 6. Cost estimate at 15,000 students (estimate — check before relying on it)

Measured on staging: average AI cost per call — voice scoring ₹0.027, written-answer grading ₹0.029, writing a Lot ₹0.08 (shared by everyone on that page), company Lot ₹0.11.

| Line | If all 15,000 are active every day | If 40% are |
|---|---|---|
| AI (grading + voice scoring) | ₹450–900 a day | ₹180–360 a day |
| Whisper transcription (extrapolated from a 17-second clip to 60 seconds) | about ₹1,100 a day | about ₹450 a day |
| Database, API, files, other services | needs a larger database tier and the CPU quota | — |
| **Month, AI + transcription only** | **about ₹47,000–60,000** | **about ₹19,000–24,000** |

Today's budget alert is ₹3,000 a month. All AI spent on staging for this whole programme: about ₹3.

---

## 7. Still open (honest list)

| Item | State | Why it matters |
|---|---|---|
| CPU quota (finding A) | OPEN, owner | Production cannot scale to its own settings |
| Whisper benchmark | BLOCKED | Needs real Indian-English / Telugu-accented recordings; synthetic speech is not valid evidence |
| F2: each function on a narrow database right | IN_PROGRESS | Sweep passed; functions still share one broad database role |
| Scheduler jobs still use a shared webhook secret (9 of 12) | NOT_STARTED | Should use Google identity like the services now do |
| Code runner still uses a shared secret | NOT_STARTED | Same reason |
| Alerts for the new log lines (`TELEMETRY PROBLEM`, `LLM TIMEOUT`, `ACCOUNT SYNC …`, `JOB SANITY: daily-lots could not…`) | NOT_STARTED | Failures are logged but nobody is paged |
| AI cost in rupees on an admin screen | NOT_STARTED | Token counts exist; no rupee view |
| Crawler: scoped discovery and "0 new" alert | NOT_STARTED | |
| Backend services are built and deployed by hand | OPEN | Only the website goes through CI |
| First `main` deploy with the new build-once step | UNPROVEN | Only runs on `main`; watch it |
| XP is paid at Submit, not after the explanation | owner decision | "Required" is enforced in the flow and the database, not in XP |
| Microphone recording in a real browser | not automated | Pipeline tested with real audio files |
| Real Google sign-in end to end | production only | Staging shares production's login pool, so staging has no logins |
| Deep bug-finder schedule | needs approval | Production scheduler change |
| Protected production test logins | needs approval | Production data |
| Unused columns `voice_explanations.proof_id`, `student_portfolios.projects` | left | Harmless; separate change |
| GitHub crawl workflow holds a copy of the production signing secret | OPEN | Must change at the production token cutover |
| Staging and production share one project and one login pool | OPEN | Root of finding A and of several test limits |

---

## 8. What I need from the owner

1. Read `PRODUCTION-ROLLOUT-CHECKLIST.md` and say yes or no to each stage.
2. Request the Cloud Run CPU quota increase (console; I cannot).
3. Decide the monthly budget for the target student count.
4. Provide 20–30 real 60-second recordings (with consent) for the Whisper benchmark, or accept the current model unbenchmarked.
5. Decide: XP at Submit or after Explain; keep or retire the old company "posted tasks".
