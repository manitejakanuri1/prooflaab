# P0: staging could delete production Google logins (12 Oct 2026) — investigation

Read-only investigation by Sidhu (S42, 13 Oct 2026). No IAM, Identity, database or service was changed. Sources:
Cloud Run logs of the production and staging accounts services, the production account-sync summaries, Cloud
Run revision metadata, project IAM policy and IAM audit logs. No email address or user id is written here.

## Answer first

1. On **12 Oct 2026 14:34 UTC** a custom role `projects/prooflab-508214/roles/prooflabStagingAccountsOperator`
   was created on the **production** project with `firebaseauth.users.create / delete / get / sendEmail / update`,
   and granted to `prooflab-staging-accounts@`. At **15:59** a second role, `prooflabStagingImportCreator`
   (`firebaseauth.users.create`), was created and granted to the same robot.
2. Until **21:11 UTC** every staging accounts revision had no `IDENTITY_PROJECT` and used `GCP_PROJECT` =
   `prooflab-508214`, i.e. **production's Identity pool**. From 21:11 (`00018-xux`) staging uses
   `prooflab-stg-identity-508214`.
3. Staging removals in that window reported success: 18:xx UTC "remove by … (college): 1 students, 0 login deletes
   failed" ×3, 21:xx ×2. (Note: the code also counts "user not found" as gone, so this line alone does not prove a
   deletion.)
4. Production account sync (every 10 min) since **19:10 UTC**: 20 students, **12** Google logins in the pool, 17
   students missing past the grace period, "NEEDS REVIEW … none suspended" (the ceiling of 3 held: nobody was
   suspended). At **21:40 UTC** the pool drops to **10** logins, right after the 21:xx staging removals.
5. **The grant is still in place** (13 Oct 00:2x UTC). The current staging revision uses the isolated project, but
   the robot can still create, update and delete production users. Any rollback of staging accounts to a revision
   older than `00018-xux` (e.g. `00015-rpk`) would again act on production's pool.

## What is proven and what is not

| Claim | Status |
|---|---|
| Staging's accounts robot had (and has) delete rights on production users since 14:34 UTC | **proven** (IAM policy + CreateRole audit) |
| Staging accounts used the production pool until 21:11 UTC | **proven** (revision env) |
| Production's pool lost 2 logins between 19:10 and 21:40 UTC | **proven** (sync summaries 12 -> 10) |
| Those 2 were deleted by the staging removals at 21:xx | **very likely** (timing; same ids in both databases) — needs the owner to compare the deleted ids |
| All 17 missing production students were deleted this way | **not proven**: the pool had only 12 logins at the first logged pass; some students may never have had a login. Identity Platform data-access audit logs are not enabled, so deletions are not individually logged |

## Owner actions (Sidhu has not done any of these)

1. **Now:** remove `prooflabStagingAccountsOperator` and `prooflabStagingImportCreator` from
   `prooflab-staging-accounts@` on project `prooflab-508214` (keep only the isolated-project role).
   Verify with `gcloud projects get-iam-policy prooflab-508214`.
2. Remove `00013`–`00017` of `prooflab-staging-accounts` from any rollback plan (they target production's pool).
3. Compare production's `account_sync_missing` / identity ledger with staging's removed accounts (ids only) to list
   which production students lost their login, then restore them (a login can be recreated with the same id via the
   admin API; the person must set a password again). Contact them.
4. Turn on Identity Platform data-access audit logs (DATA_WRITE) on the production project so a deletion is
   recorded with who did it.
5. Keep the production sync's ceiling (it is what prevented 17 suspensions).
