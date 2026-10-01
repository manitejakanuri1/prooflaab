# G05 — least-privilege runtime accounts, Editor removed: verification (1 Oct 2026)

**Result: G05 PASS.** No account in the project holds `roles/editor`. Every production service and job
runs as its own robot with only what it needs. Everything was re-tested live afterwards.

## Who runs what now (live, 1 Oct 2026)

| Runtime | Service account | Revision |
|---|---|---|
| prooflab-api | `prooflab-rt-api` | 00004-rom (tested on a 0 % tag first) |
| prooflab-auth-bridge | `prooflab-rt-authbridge` | 00012-vdh |
| prooflab-files | `prooflab-rt-files` | 00014-r2w |
| prooflab-accounts | `prooflab-rt-accounts` | 00003-rgf |
| prooflab-functions | `prooflab-rt-functions` | 00053-c7m |
| prooflab-transcriber | `prooflab-rt-transcriber` | 00003-v7l |
| prooflab-code-runner | `code-runner` (unchanged) | 00001-rpr |
| prooflab-transcription-worker | `prooflab-transc-wk` (unchanged) | 00001-sl6 |
| job prooflab-bug-finder | `prooflab-rt-bugfinder` | — |
| job prooflab-crawler | `prooflab-rt-crawler` | — |
| Scheduler → jobs (bugfinder, deep, crawler) | `prooflab-rt-scheduler` (run.invoker on the two jobs only) | — |

## Permissions (read from IAM)

| Account | Project roles | Secrets | Other |
|---|---|---|---|
| rt-api | logWriter; cloudsql.client **only for `prooflab-db`** (condition prod-db-only) | db-uri, jwt | — |
| rt-authbridge | logWriter | jwt | — |
| rt-files | logWriter | jwt | objectAdmin on private + public buckets |
| rt-accounts | logWriter, identitytoolkit.admin | jwt, webhook | — |
| rt-functions | logWriter | jwt, deepseek, github-pat, resend, webhook, code-runner | objectAdmin on both buckets; cloudtasks.enqueuer on `prooflab-transcription`; actAs `prooflab-tasks-invoker` |
| rt-transcriber | logWriter | jwt | — |
| rt-bugfinder | logWriter | jwt, smoke-student, college, admin passwords | — |
| rt-crawler | logWriter | jwt, github-pat | — |

These match the dependency table in `OWNER-COMMANDS.md` section 8 and each runtime's live secret
references.

## Live proof after the migration

| Check | Result |
|---|---|
| Sign-in, all four roles | student, college, admin, company ✓ |
| `authz_matrix_check.py` | 58/58 |
| `healthcheck.py` | 24/24 |
| `attack_surface_check.py` | 66/66 |
| Functions `/ready` | 40/40 |
| Real transcription (transcriber robot) | 200, 25.8 s clip → 66 words in 3.5 s |
| **New live voice recording** (files upload → functions enqueue with the new robot → Cloud Tasks → private worker → Whisper → DeepSeek) | scored **72**, server transcript, 1 attempt; worker 200 |
| Build-Log in a browser | 72/100, Scored, Server-verified, transcript visible |
| Scratchpad Run (functions → code runner) | "ProofLab runner OK", nothing saved |
| Company / admin / college dashboards in a browser | 12/12, 3/3, 3/3 |
| Bug finder job (new robot, 03:09 UTC) | 10/10 steps |
| Scheduler | all 13 jobs last result OK; accounts-sync OK after its switch; reaper `TRANSCRIPTION-REAP OK` |
| Cloud Build (still uses the compute account) | no-op build `2df47101…` SUCCESS |
| Data invariants re-run (read-only, 19 checks) | 0 failures: no stuck or unscored voice, no broken links, scratch values valid |
| Real data unchanged | still 4 students; the real students' only submission and recording are from 30 Sep |

## Left over (accepted, non-blocking)

- **G35 (P2):** the old compute account no longer runs anything at runtime, and it lost Editor.
  It still holds older grants: read access to the production secrets, objectAdmin on both buckets,
  `cloudsql.client`, `storage.objectViewer`, and actAs on `prooflab-tasks-invoker`. Only Cloud Build
  uses it, and only owners can start builds. Clean-up: remove those grants once a build is confirmed
  not to need them.
- **G36 (P3):** the crawler has not run under its new robot yet. Its only needs (jwt, github-pat) are
  granted. The next scheduled run is Sunday 08:10 IST, covered by the "[P2] The weekly crawler
  failed" alert.
- **G37 (P3):** the functions `/ready` credential self-check asks the metadata server for the wrong
  path, so it shows "answered 404". This has been so since at least 30 Sep and is unrelated to the
  migration; the real token calls use the correct path, as the live voice test proves.
