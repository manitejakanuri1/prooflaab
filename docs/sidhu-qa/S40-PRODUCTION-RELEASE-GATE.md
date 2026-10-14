# S40 production release gate (13 Oct 2026)

QA branch: `fix/sidhu-s40-e2e-and-identity-faults-2026-10-13`. It contains TEJA's identity lifecycle `441d378`
(migration 110), merged, not rebased, with two S40 fixes on top. Every row below is PASS, FAIL, BLOCKED or NOT RUN.
"PASS" means really exercised. A mocked or offline test is labelled OFFLINE, never live.

**Verdict today: NO-GO.** The integrated build is not deployed to staging, and no signed-in E2E has run.

## 1. Exact versions (the gate is only valid for these)

| Item | Must be | Today |
|---|---|---|
| Release SHA | one full SHA, CI green for that SHA | TEJA `441d378` + S40 (latest QA SHA in the release report). **No integrated release SHA named yet.** |
| Staging site | the `vite build --mode staging` entry of that SHA | `index-BbfwBTK1.js` = `59235dd` (8 Oct). **BLOCKED** |
| Staging functions / web-bff / accounts / files at 100% | revisions built from that SHA | `00075-git` / `00004-9nn` / `00015-rpk` / `00012-gf4`, all older. **BLOCKED** |
| Staging ledger | 105, 106, 106a, 107, 108, 109, **110** | 105-109 present; **110 absent**. **BLOCKED** |
| Production | backup taken, rollback revisions noted | functions `00063-zaw` (prev `00060-n4g`); DB 108+109 applied 12 Oct |

## 2. Functionality (live staging E2E, `staging-live-e2e.yml`)

| Pass | Needs | Today |
|---|---|---|
| Signed-out: every screen and every gateway address | nothing | **PASS** baseline on `59235dd`: 100 screens, 68 API probes, 0 FAIL (S40 CI, daily 07:00 IST) |
| 1. Five roles sign in, every screen and tab, role isolation | environment `staging-e2e` + 15 login secrets | **BLOCKED**: environment does not exist (`sidhu_s40_e2e_readiness.mjs`) |
| 2. Writes on disposable fixtures + read-only DB proof | 13 fixture secrets + QA identity variables | **BLOCKED** |
| 3. Destructive: app deletion, Console deletion, revocation, retry | 3 disposable-identity secrets + isolated staging Identity tenant (TEJA `SHARED_IDENTITY` refuses Google writes otherwise) | **BLOCKED** |
| Recruiter | signs in as Company (`startup`); `/recruiter/dashboard` opens the Company dashboard | covered by the Company role |

## 3. Security and identity

| Check | Today |
|---|---|
| Anonymous: 46 closed gateway routes refuse with and without a forged token | PASS live (baseline) |
| Gateway: deleted/disabled Google account, all 4 roles, every Google error | PASS OFFLINE (57 tests) |
| A Console-deleted account keeps an open session until token refresh (about 55 min) | measured OFFLINE; TEJA's 110 sync cuts access after the grace period + exact lookup; live proof BLOCKED (pass 3) |
| Sync over real HTTP: auth, dry run, failures, reruns, never deletes | PASS OFFLINE (8). **Fixed S40:** dry run answered 404 |
| Unmapped accounts (15,004 seeded on staging) never marked or cut | PASS OFFLINE (6 + 1 end to end). **Fixed S40:** before, every staging pass aborted, and elsewhere such accounts were cut 3 per pass |
| Migration 110: RLS, grants, idempotency, rollback | PASS OFFLINE (TEJA PGlite 20/20, run again in the S40 merge: 74/74 with S34-S39) |
| S38-01: production buckets keep deleted files as versions with no end date | **OPEN, owner**: blocks production self-deletion |

## 4. Data integrity, performance, monitoring, rollback

| Item | Today |
|---|---|
| Squad fill (108), branch list (109) | live in production since 12 Oct; nightly job must show `colleges_failed: 0` |
| Backups | production backup before 108/109 (12 Oct); a new one is required before 110 |
| Performance | no load test of the 110 sync at production size; the sync reads every account once per pass. **NOT RUN** |
| Monitoring | `ACCOUNT SYNC ABORTED / NEEDS REVIEW / LOOKUP FAILED / SUSPENDED`, `IDENTITY LIFECYCLE STALE`, `JOB SANITY: nightly-squads`. Alert policies for the new 110 lines: **not verified** |
| Rollback | `110-rollback`, revisions to restore, `108-rollback`; each restore drill **NOT RUN** on staging |

## 5. Remaining blockers, in order

1. **TEJA:** name the integrated release SHA (441d378 + S40 `d4840a8`/later, or a merge of both), green CI on it.
2. **TEJA + owner:** deploy that SHA to staging (site and the four services) and apply 110 there. Isolated Identity
   tenant for staging, or accept that staging runs the sync as dry run only.
3. **Owner:** create `staging-e2e` and add the secrets. `node scripts/dev-tools/sidhu_s40_e2e_readiness.mjs` lists
   them and prints the `gh secret set` commands (values are typed into gh's prompt, never shown).
4. **Owner:** QA read-only identity (`QA_WIF_PROVIDER`, `QA_SERVICE_ACCOUNT`) for revision provenance and DB proof.
5. **Sidhu:** run passes 1, 2 and 3 on that SHA; fix or hand over every FAIL; rerun.
6. **Owner:** S38-01 decision (versions and retention); retention periods (S36-05).
7. **Owner:** production approval, backup, then 110 and the services, one at a time, with health check and rollback ready.

GO requires 1-5 all PASS, no open P0/P1, and 6 decided.
