# S36: staging release blockers

Date: 10 October 2026. Branch `fix/teja-claude-s36-staging-blockers-2026-10-10`, built on S34 `6ec04f5` with
Sidhu's S34 QA branch (`29b5cfd`) merged. Canary results for the final commit are in the hand-off message and in
`e2e-out/s34-staging/evidence-<commit>.txt` (not in git, so the commit id does not change).

## 1. Migrations 106 and 107

Sidhu and I each wrote a repair numbered 106 for the same bug. There is now **one**:

| Migration | Author | What it does | Applied on staging |
|---|---|---|---|
| 105 | TEJA (S34) | the four controls; **bug**: `remove_students()` rebuilt from an old body | yes (9 Oct 11:42 UTC), byte-for-byte the repository file |
| **106** | **Sidhu** | one anchored replacement in the live function: the dead entry becomes migration 65's `submissions` entry. Checks that nothing else changed. No rollback (undoing it breaks removal again). | **no** |
| **107** | TEJA (S36) | consent guard (only the student can switch audio sharing on); the self-deletion record keeps the login id so a failed login deletion can be finished; `review_outcome`, `sponsored_task`, `college_linked` cannot be switched off (Sidhu's P2) | **no** |

My earlier 106 (S34) is withdrawn: it replaced the whole function, which is the same kind of risk that caused the
bug. 107 changes the live function by one anchored addition and checks owner, grants and settings afterwards.

### Safety checks done (read-only on staging)

| Check | Result |
|---|---|
| Staging PostgreSQL version | 17.11 (106 uses `regexp_count`, which needs 15 or newer) |
| 106's pattern in the live function | found exactly once: 106 will apply |
| 107's anchor in the live function | found exactly once: 107 will apply |
| 105's ledger checksum equals the repository file | yes (`e3b53f35…`) |
| Still broken now | yes: the function reads the missing table |
| Anyone affected | 0 self-deletions, 0 students sharing audio, 0 templates, 0 rules |

### Tests on a real PostgreSQL engine (local, throwaway)

- `s34_migration_105.test.mjs`: 105 + 106 + 107 as written, 9 of 9. Includes: 105 alone fails and lets an admin
  give consent; with 106 and 107 both are fixed; consent, company authorization, removal rules, protected
  notices; both rollbacks; re-apply after rollback.
- `sidhu_s34_remove_students.test.mjs` (Sidhu): 5 of 5.

### Commands (not run)

```bash
cd /c/Users/manit/Downloads/prooflabai-mvp/prooflabai-claude-s36

# 1. backup
gcloud sql backups create --instance=prooflab-staging-db --project=prooflab-508214 --description="before 106+107"

# 2. apply, through the ledger, in this order. Each stops by itself if its self-check fails.
bash scripts/dev-tools/staging_migrate.sh migration/106-remove-students-restore-submissions-backup.sql
bash scripts/dev-tools/staging_migrate.sh migration/107-consent-guard-and-login-tracking.sql

# 3. rollback of 107 only (106 has none on purpose). Switches every student's audio sharing off first.
bash scripts/dev-tools/staging_sql.sh migration/107-rollback-consent-guard-and-login-tracking.sql

# 4. last resort: restore the backup from step 1 (replaces the whole staging database)
gcloud sql backups list --instance=prooflab-staging-db --project=prooflab-508214 --limit=3
gcloud sql backups restore <BACKUP_ID> --restore-instance=prooflab-staging-db --project=prooflab-508214
```

Or as one locked step: `STAGING_RELEASE_AUTHORIZED=<commit> bash scripts/dev-tools/s34_staging_batch.sh migrate <commit>`.

106 can go on by itself today: it only repairs. 107 is needed before the new accounts image takes traffic.
Production: 105, 106 and 107 in one window, never 105 alone.

## 2. Transcriber and gateway `/ready` 503: root cause

**Not a code fault. The project ran out of Cloud Run CPU quota.**

| Evidence | Value |
|---|---|
| Transcriber request log, 9 Oct 12:16 to 12:45 UTC, 7 times | `503 The request failed because the project exceeded its quota limit for run.googleapis.com/cpu_allocation recently.` |
| Quota `CpuAllocPerProjectRegion`, `asia-south1` | **20,000 milli-vCPU (20 vCPU), for production and staging together** |
| Quota usage, 11:35 to 13:00 UTC | at or over 20,000 in 11 of 18 five-minute periods, never under 12,000 |
| Running instances in that window | production about 10 by itself; staging canary deploys and checks added 4 to 8 |
| Transcriber settings | 2 vCPU per instance, scales to zero, one request per instance |
| Transcriber now | `/ready` 200 in 0.5 s; revision `00009-nxp`, no crash, no memory error, no failed start in 3 days |

Why the transcriber and nobody else: it scales to zero and needs 2 vCPU to start. When the quota is full, Cloud
Run refuses to start it and answers 503 itself; the request never reaches the container. The gateway's `/ready`
asks the transcriber, so it reported `failed: ['transcriber']`.

Proof the gateway is otherwise healthy: the S34 gateway canary (`00009-cor`, 0% traffic) answers
`/ready` **200, state `ready`** now that quota is free, with no change to it and no effect on the live site.

### The fix (owner action; affects production too, so I did not do it)

Raise the regional quota. Production uses about half of it while idle, so this is also a launch risk at 2,000
students.

```bash
gcloud beta quotas preferences create --project=prooflab-508214 --service=run.googleapis.com \
  --quota-id=CpuAllocPerProjectRegion --dimensions=region=asia-south1 \
  --preferred-value=100000 --preference-id=run-cpu-asia-south1 --justification="Production and staging share one project; launch at 2,000 students"
```

Until it is raised: do not run load tests, canary deploys and the browser suite at the same time; a `/ready`
503 that names only `transcriber` should be retried after a minute before it is treated as a failure.

Not changed on purpose: the gateway still treats the transcriber as required for readiness. Making it optional is
a design decision for the owner and Sidhu, not a quiet fix.

## 3. Staging release state

| Layer | State |
|---|---|
| Coded and tested locally | everything on this branch |
| Staged at 0% traffic | functions, accounts, gateway from **this** commit under tag `s36` (see the hand-off message). The older `s34` canaries were built from `79644f6`, which has the broken 105 and none of the fixes; they are left alone. |
| Database on staging | 104 and 105. **106 and 107 not applied.** |
| Active staging (100% traffic) | functions `00075-git`, accounts `00015-rpk`, gateway `00004-9nn`, site `index-BbfwBTK1.js` (commit `59235dd`). All older than S34. |
| Production | unchanged. Not touched by any of this. |

Pipeline `scripts/dev-tools/s34_staging_batch.sh`, phases: `preflight` (read-only), `canary`, `migrate`,
`switch`, `smoke`, `e2e`, `rollback`. Two approvals, each tied to one exact commit:
`STAGING_CANARY_AUTHORIZED` for 0% revisions only; `STAGING_RELEASE_AUTHORIZED` for the database, traffic and site.
`switch` refuses until 106 and 107 are recorded. `e2e` runs Sidhu's suite with the exact-build check for the
site and the three services, and never the destructive recipe.

Limit: a canary at 0% cannot be browser-tested from the staging site, because the site talks to whatever serves
100%. A separate preview site wired to the canaries is possible but is its own piece of work (gateway settings and
allowed origins); not built.

## 4. Dashboards

Carried from S34 and unchanged here: safe self-deletion with retry, full file cleanup, consent guard, test email,
no dead controls. New in S36: the three protected notices. Sidhu's suite is now his newer version (12 recipes,
exact-build gate, GitHub workflow); my separate recipe file is removed because his covers the same controls.

Nothing here is a live result. Unit and database tests prove the code; they do not prove the screens.

## 5. Manager demo accounts

BLOCKED. No confirmation of the five logins has reached this session, so no signed-in browser test was run and no
Identity user, password or fixture mapping was read or changed.

## 6. Remaining blockers, in order

1. Owner: apply 106 (and 107) to staging.
2. Owner: raise the Cloud Run CPU quota.
3. The five demo logins confirmed, then the signed-in suite.
4. Owner: approve `switch` for this commit (traffic and staging site).
5. Sidhu: independent sign-off on 107 and the deletion flow.
6. Production: nothing is ready to go there until 1 to 5 pass on staging.
