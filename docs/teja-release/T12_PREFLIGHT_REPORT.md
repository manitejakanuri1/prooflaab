# TEJA T12 — Staging Release Preflight

Mode: local static review and input-validation dry run.
Source baseline: 59235dd (Claude changes in another worktree).

| Gate | Evidence | Status |
|---|---|---|
| Cloud Run inventory | 10 services recorded | PASS |
| Cloud SQL backups | 5 successful backups listed | PASS |
| Staging SITE_URL | prooflab-staging-accounts, prooflab-staging-functions | BLOCKED |
| Unsafe RLS policies | Three policies confirmed by T9 | BLOCKED |
| Migrations 100/101 | Prepared by Claude; not applied | BLOCKED |
| Session revocation | Claude local tests only; not deployed | BLOCKED |
| Production publish | Main branch publish detected | BLOCKED |
| Hosting BFF configuration | Workflow mentions BFF_SERVICE: no; hosting script mentions it: yes | REVIEW |
| Real four-role E2E | Not yet executed | BLOCKED |

## Release safety requirements

- Review Claude migrations 100/101 and independently test against real PostgreSQL.
- Verify a restorable staging backup before any approved SQL write.
- Preserve intentional staging Identity permissions; do not grant access to the shared production login pool.
- Stage Accounts/Functions SITE_URL changes only after approval.
- Require staging BFF and actual /api rewrite verification before Hosting publication.
- Require real four-role login, suspension, tenant isolation, coding Run/Submit and rollback evidence.
- Never merge to main while production BFF routing remains unresolved.

## Important limitation

This report checks recorded configuration and static source references.
It does not deploy, prove generated Firebase rewrites, test restore,
or establish live release readiness.
