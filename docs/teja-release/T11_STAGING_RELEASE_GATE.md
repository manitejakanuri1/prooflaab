# ProofLabAI — TEJA Staging Release Gate

Date: 2026-10-08

Environment: Staging only

Mode: Read-only inspection and local preparation.

## Already confirmed by T9

- Staging PostgreSQL RLS is enabled on user_roles, colleges and startups.
- Three historical self-registration policies were active at T9.
- schema_migrations records versions 95–98.
- Managed-account policy remediation is not yet applied.
- Cloud Run T9 execution completed successfully.

These historical findings do not replace post-migration verification.

## Staging Cloud Run Services

### prooflab-staging-accounts
- Containers: 1
- Latest ready revision: prooflab-staging-accounts-00014-zpt
- Traffic: prooflab-staging-accounts-00014-zpt = 100%
- SITE_URL: MISSING - RELEASE BLOCKER
- POSTGREST_URL: PRESENT (configured; value hidden)
- Other environment values: redacted

### prooflab-staging-api
- Containers: 1
- Latest ready revision: prooflab-staging-api-00006-6x4
- Traffic: prooflab-staging-api-00006-6x4 = 100%
- Other environment values: redacted

### prooflab-staging-auth-bridge
- Containers: 1
- Latest ready revision: prooflab-staging-auth-bridge-00012-vsq
- Traffic: prooflab-staging-auth-bridge-00012-vsq = 100%
- POSTGREST_URL: PRESENT (configured; value hidden)
- Other environment values: redacted

### prooflab-staging-code-runner
- Containers: 1
- Latest ready revision: prooflab-staging-code-runner-00007-xop
- Traffic: prooflab-staging-code-runner-00006-6fv = 100%
- Traffic: prooflab-staging-code-runner-00007-xop = unknown%
- Other environment values: redacted

### prooflab-staging-files
- Containers: 1
- Latest ready revision: prooflab-staging-files-00012-gf4
- Traffic: prooflab-staging-files-00012-gf4 = 100%
- Other environment values: redacted

### prooflab-staging-functions
- Containers: 1
- Latest ready revision: prooflab-staging-functions-00071-n8f
- Traffic: prooflab-staging-functions-00071-n8f = 100%
- SITE_URL: MISSING - RELEASE BLOCKER
- POSTGREST_URL: PRESENT (configured; value hidden)
- Other environment values: redacted

### prooflab-staging-tasks-test-worker
- Containers: 1
- Latest ready revision: prooflab-staging-tasks-test-worker-00001-58j
- Traffic: prooflab-staging-tasks-test-worker-00001-58j = 100%
- Other environment values: redacted

### prooflab-staging-transcriber
- Containers: 1
- Latest ready revision: prooflab-staging-transcriber-00009-nxp
- Traffic: prooflab-staging-transcriber-00009-nxp = 100%
- Other environment values: redacted

### prooflab-staging-transcription-worker
- Containers: 1
- Latest ready revision: prooflab-staging-transcription-worker-00025-h4b
- Traffic: prooflab-staging-transcription-worker-00025-h4b = 100%
- POSTGREST_URL: PRESENT (configured; value hidden)
- Other environment values: redacted

### prooflab-staging-web-bff
- Containers: 1
- Latest ready revision: prooflab-staging-web-bff-00004-9nn
- Traffic: prooflab-staging-web-bff-00004-9nn = 100%
- AUTH_BRIDGE_URL: PRESENT (configured; value hidden)
- POSTGREST_URL: PRESENT (configured; value hidden)
- SESSION_KEY: PRESENT (secret reference)
- Other environment values: redacted

## Recent Staging Database Backups

Backup presence is not proof that a restore has been tested.
- Status: SUCCESSFUL | Start: 2026-10-08T03:54:21.572Z | Type: AUTOMATED
- Status: SUCCESSFUL | Start: 2026-10-07T03:39:37.802Z | Type: AUTOMATED
- Status: SUCCESSFUL | Start: 2026-10-06T04:37:13.114Z | Type: AUTOMATED
- Status: SUCCESSFUL | Start: 2026-10-05T04:15:48.699Z | Type: AUTOMATED
- Status: SUCCESSFUL | Start: 2026-10-04T04:18:54.750Z | Type: AUTOMATED

## Release Source Files
- PRESENT: .github/workflows/deploy.yml
- PRESENT: scripts/deploy-hosting.py
- PRESENT: DEPLOYING.md
- PRESENT: package.json
- PRESENT: web-bff/Dockerfile

## Current Release Decisions

| Gate | State |
|---|---|
| T9 staging database inspection | PASS |
| Remove unsafe self-registration policies | BLOCKED — approved SQL migration required |
| Immediate suspended-session denial | BLOCKED — Claude repair pending |
| Managed-account migration validation | PENDING |
| Staging config alignment | Requires review of service inspection above |
| Unified staging build and deployment | NOT STARTED |
| Real Admin login | NOT PROVEN |
| Real College login | NOT PROVEN |
| Real Student login | NOT PROVEN |
| Real Company login | NOT PROVEN |
| Production release | NO-GO |

## Required Deployment Order

1. Review integrated release candidate and exact migrations.
2. Verify fresh staging backup and approved rollback procedure.
3. Apply only separately approved staging migrations.
4. Verify live RLS policies and application provisioning.
5. Update separately approved staging service configurations.
6. Deploy compatible backend and gateway revisions.
7. Deploy staging Firebase Hosting with correct API routing.
8. Run live four-role, authorization and recovery tests.
9. Review evidence before any production release.

## Safety Record

No deployment, SQL modification, Cloud Run traffic update,
IAM change, Git commit, Git push or production change
was requested by this script.
