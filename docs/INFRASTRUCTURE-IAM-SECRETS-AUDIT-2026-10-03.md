# Infrastructure, IAM and secrets audit — 3 Oct 2026 (CFG = read-only now)

## 1. Cloud Run (production)

| Service | Revision | SA | Max × conc | CPU/RAM | Timeout | Invoker | Class |
|---|---|---|---|---|---|---|---|
| prooflab-api | 00004-rom | rt-api | 4 × 80 | 1 / 512Mi | 30 s | allUsers | PUBLIC_BROWSER_ENTRY |
| prooflab-functions | 00053-c7m | rt-functions | 4 × 80 | 1 / 1Gi | 300 s | allUsers | PUBLIC_BROWSER_ENTRY |
| prooflab-auth-bridge | 00012-vdh | rt-authbridge | 3 × 80 | 1 / 256Mi | 20 s | allUsers | PUBLIC_BROWSER_ENTRY |
| prooflab-files | 00014-r2w | rt-files | 4 × 80 | 1 / 512Mi | 60 s | allUsers | PUBLIC_BROWSER_ENTRY |
| prooflab-accounts | 00003-rgf | rt-accounts | 2 × 80 | 1 / 512Mi | 300 s | allUsers | AUTHENTICATED_PUBLIC (secret/token) |
| prooflab-transcriber | 00003-v7l | rt-transcriber | 3 × 1 | 2 / 2Gi | 120 s | allUsers | AUTHENTICATED_PUBLIC (ticket) |
| prooflab-code-runner | 00001-rpr | code-runner (no roles) | 6 × 1 | 2 / 2Gi | 120 s | **allUsers** | AUTHENTICATED_PUBLIC (secret header) → should be INTERNAL (N10) |
| prooflab-transcription-worker | 00001-sl6 | transc-wk | default × 80 | 1 / 512Mi | 300 s | tasks-invoker only | INTERNAL_ONLY |
| Jobs: bug-finder, crawler | — | rt-bugfinder, rt-crawler | — | — | — | scheduler (rt-scheduler) | JOB_ONLY |

All ingress = `all`; no VPC connector or egress controls on any service (code runner egress open: F9).
Staging: 9 services with `prooflab-staging-*` SAs (incl. a leftover `staging-tasks-test-worker`).

## 2. IAM

- **No `roles/editor` binding** in the project (CFG): G05 holds.
- The compute SA (`135298577404-compute`) is used by no runtime, but keeps:
  - project roles: artifactregistry.writer, cloudbuild.builds.builder, cloudsql.client, logging.logWriter, storage.objectViewer;
  - read access to **every production secret**;
  - objectAdmin on both buckets;
  - actAs on tasks-invoker.

  That is G35/N14 (P2).
- `firebase-adminsdk-fbsvc`: token-creator role (G08, accepted).
- Staging accounts SA: only logWriter (G06 closed).
- Per-secret readers are listed in `docs/SECURITY-THREAT-AND-PERMISSION-AUDIT-2026-10-03.md` §4.

## 3. Scheduler (12 production + 1 staging; all `Asia/Kolkata`; all last result code 0 on 3 Oct)

| Job | Cron (IST) | Target | Auth | Retries | Deadline |
|---|---|---|---|---|---|
| accounts-sync | */10 | accounts /sync | webhook secret | 0 | 120 s |
| transcription-reap | every min | functions | webhook secret | 0 | 60 s |
| nightly-squads / extend-fixtures / daily-lots | 05:35 / 05:37 / 05:40 | functions scheduled-job | webhook secret | 2 | 540 s |
| prune-events | 03:10 | functions | webhook secret | 0 | 180 s |
| weekly-plan | Mon 08:00 | functions | webhook secret | 2 | 540 s |
| weekly-seasons / weekly-progress | Sun 23:30 / 23:45 | functions | webhook secret | 2 | 540 s |
| bugfinder-run / bugfinder-deep-run | 06,10,14,18,22 / 04:00 | Run job API | OAuth rt-scheduler | 0 | 180 s |
| crawler-weekly | Sun 08:10 | Run job API | OAuth rt-scheduler | 0 | 180 s |

D3: no UTC/IST shift (the time zone is set explicitly). D2: 12 prod + 1 staging.

## 4. Storage

| Bucket | Access | Contents (objects) | Notes |
|---|---|---|---|
| prooflab-private-508214 | private, PAP enforced, versioning on, 7-day soft delete | books 1, proofs **1**, resumes **65**, voice-explanations **32** | orphans of removed students (N2); legacy proofs (D5) |
| prooflab-public-508214 | objects public, listing closed | profile-photos | |
| prooflab-backups-508214 | private | SQL exports | |
| staging buckets | private/public | staging | |

No lifecycle rules (retention unlimited).

## 5. Secrets
See the security audit §4. No secret values were printed. `GOOGLE_API_KEY` is plain env, equal to the public browser key.

## 6. Infrastructure as code (F18)
None. The only reproducible pieces are `scripts/setup_monitoring.py` (alerts and uptime checks),
`scripts/deploy-hosting.py`, and `OWNER-COMMANDS.md`/runbook command blocks. Cloud Run, IAM, the
scheduler, tasks, buckets and secrets all exist only in the console. **Drift risk: high.**

## 7. Observability
- 27 alert policies and 8 uptime checks with an email channel.
- Budget alert at ₹3,000 (50/80/100%).
- Error Reporting and Query Insights are on.

Gaps:
- No alert for "AI usage not logged" or "rate limiter not writing" (F3 went unnoticed).
- No alert on mass student removal (F6).
- The bug-finder alerts are now noisy because the test student is missing (N1).
