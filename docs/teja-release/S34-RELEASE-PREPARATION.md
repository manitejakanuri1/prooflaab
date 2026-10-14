# S34 release preparation: blockers closed in code, staging pipeline ready, nothing run

Date: 10 October 2026. Branch `feat/teja-claude-s34-live-functionality-2026-10-10`.
This follows [`S34-LIVE-FUNCTIONALITY.md`](S34-LIVE-FUNCTIONALITY.md) and replaces its sections 3.5, 5 and its
"left as they are" table.

> **Superseded in part by [`S36-STAGING-BLOCKERS.md`](S36-STAGING-BLOCKERS.md):** the repair is now Sidhu's migration 106
> plus migration 107; the `106-live-controls-repair` file named below no longer exists.

**Short answer.** The five blockers are closed in code and tested locally, including migration 105 executed on a
real PostgreSQL engine. Sidhu's S32 live suite is merged with nothing of S34 reverted. One staging-only pipeline
is ready. **Nothing was deployed, no migration was applied, no signed-in browser test was run.** There is still
no live PASS for any control: the source inventory (647 controls) is a list, not a result.

## 0. Read this first: staging is broken by my first migration, and the fix needs your yes

The read-only preflight found two things on staging (10 October):

| Finding | Evidence |
|---|---|
| Migration 105 is **already applied on staging**, in its first version (commit `1290643`). I did not apply it. | ledger row `105-live-controls`, checksum `e3b53f35…`, applied 9 Oct 11:42 UTC |
| **That version has a bug of mine.** It rebuilt `remove_students()` from migration 17's body instead of migration 65's, the current one. The old body reads the retired proof-upload table, which no longer exists on staging. | read-only query: retired table `MISSING`, function body still reads it |

What this means today:

- **On staging, removing a student fails** for a college, an admin and the student themself. The call errors
  and removes nothing, so no data is lost. Nothing else is affected.
- Nobody has used the new controls there: 0 self-deletions, 0 students sharing audio, 0 templates, 0 rules.
- Production is untouched (105 is not there).

How I missed it: I searched for the function with a lower-case pattern, and migration 65 writes it in capitals.
The real-database test I added afterwards catches it (test "why 106 exists").

The fix is **migration 106** (`migration/106-live-controls-repair.sql`): migration 65's body with the `self`
reason added, plus the consent guard and `login_deleted_at`. Migration 105 is left byte-for-byte as applied, so
the ledger still accepts it. Production will get 105 and 106 together.

**Decision needed:** apply 106 to staging now (one command, behind a backup), or with the rest of the release:

```bash
bash scripts/dev-tools/staging_migrate.sh migration/106-live-controls-repair.sql
```

I have not run it.

Also changed since yesterday, not by me: the release switch is now set on the staging gateway.

## 1. The five blockers

| # | Blocker | What changed | Proof |
|---|---|---|---|
| 1 | Deletion must not report success when the login deletion fails | New order: find login, **disable** it, delete data, delete login (3 tries), record it. Every failure point is safe (table below). The screen shows "Your data is deleted… your sign-in has been locked" when the login is only locked. The sync job retries pending logins. All stored files (resumes, voice audio, photo) are deleted by the daily job, retried until done. | `accounts/test_self_delete.py` 11 cases; `owner-files_test.ts` 3; `deleteMyAccount.test.ts` 4 |
| 2 | Email Templates must reach real delivery | "Send test to me" in the templates window sends the real welcome email, with the saved wording, to the admin's own address. "Not switched on" is shown as a failure. Staging already has a mail key and sender (`staging-noreply@notify.prooflab.co.in`): **no secret change is needed.** | `email-template_test.ts` 2; live recipe `s34-admin-email-template` (not run) |
| 3 | Every visible control must do something | Frames, Subscribe and Blog are **removed**. See the note below on Subscribe. | Inventory: 647 controls, 0 without an action |
| 4 | Audit migration 105 before it is applied | Audited: **one bug (section 0) and one consent gap (below) found**, both fixed in migration 106. 105 and 106 executed on PostgreSQL with 9 scenario tests, plus a mutation check. | `s34_migration_105.test.mjs` 9 of 9 |
| 5 | Wider live coverage | Sidhu's suite (1,290 rows, all four dashboards: navigation, redirects, API calls, failure and retry, role isolation) plus 5 new write recipes for the S34 controls, each with a database proof. | `sidhu_s32_live_e2e.test.mjs` 9 of 9; nothing run live |

### Deletion: what happens at each failure

| Fails at | Data | Login | The student is told |
|---|---|---|---|
| Finding the login | kept | untouched | "Not deleted. Nothing was changed." |
| Disabling the login | kept | untouched | same |
| Deleting the data | kept | enabled again | same |
| Deleting the data, and re-enabling also fails | kept | locked | "Not deleted, but your login is now locked. Contact support." Logged as `SELF DELETE NEEDS REVIEW`. |
| Database answer lost after it deleted | gone | deleted | success (the `removed_students` record decides, not the lost answer) |
| Deleting the login, 3 times | gone | **locked, pending** | "Your data is deleted. Your sign-in has been locked… we will finish removing it." Never "done". |
| Deleting files | gone | gone | nothing: `files_purged_at` stays empty and the daily job retries; each failure is logged |

### The gap the audit found in migration 105

`student_profiles` lets an **administrator** update any student's row. So an admin, or the backend, could have
switched a student's "let companies listen" on without the student. Fixed in migration 106: a trigger allows the
switch to go **on** only when the signed-in person is that student. Anyone who may edit the row may switch it off.
The test proves an admin and the backend are both refused, and that the test fails if the rule is removed.

Other points checked and found correct: the company check matches `is_verified_recruiter()`; every refusal answers
the same (no way to learn who has recordings); the browser role cannot call the path function at all; a recording
that is withdrawn, not server-verified, not current, or from a student who is no longer discoverable is refused;
refusals are not recorded as listens; the rollback switches every student off.

Limit: the test database has only the tables 105 touches and a stand-in for the company profile function. The
first run against the full schema is the staging run, behind a backup.

### Subscribe: I did not do what I said I would

I said I would make Subscribe save the address to a new table. I removed it instead, for two reasons:

1. It promised "weekly job and task updates by email". Nothing sends those. Collecting addresses for it would be
   collecting personal data on a promise the product does not keep.
2. It needs a write path open to signed-out visitors, and the gateway has no rate limit anywhere.

If you want the newsletter, say so: it is a table, one gateway route with a limiter, and Sidhu's review.

## 2. Sidhu's S32 suite

- Merged as commit `56ca7bd` (4 new files). No S34 file was changed by the merge.
- One of his assertions is updated, marked in the file for his review: it required "Configure Email Templates"
  and "Manage Notification Rules" to be never auto-clickable, because at `5bef957` they were dead. They now only
  open a window. The new assertion requires the **Save** inside the window to be never auto-clickable.
- One line added to his suite: it loads `s34_live_recipes.mjs` into his recipe list. His guards (single read-only
  SELECT per proof) accept all five.

For his independent sign-off, the things to attack:

| Area | Where |
|---|---|
| Consent bypass | `guard_share_voice_audio` in `migration/106-live-controls-repair.sql`; `set_share_voice_audio`, `company_voice_recording` in `migration/105-live-controls.sql` |
| Audio leak | `supabase/functions/company-voice-play/index.ts` (no path or link returned; 404 for every refusal) |
| Deleting someone else | `accounts/server.py` `removal_reason`, `accounts/self_delete.py`, `remove_students(..., 'self')` |
| Mail abuse | `_shared/email-template.ts` (escaping, header injection), test send goes only to the caller's own address |
| Path deletion | `_shared/owner-files.ts` (uuid only) |

## 3. The staging pipeline (not run)

`scripts/dev-tools/s34_staging_batch.sh <phase> <commit>`

| Phase | Does | Changes staging? |
|---|---|---|
| `preflight` | CI result, what is serving, migration ledger (103 must be recorded), mail settings, release switch, test accounts | no |
| `prepare` | records rollback targets, database backup, migrations 104 to 106 (104 and 105 are already recorded and are skipped), Cloud Build of functions, accounts and gateway, canaries at 0% tagged `s34` and labelled with the commit, evidence file (image digests), canary checks | database yes; traffic no |
| `switch` | traffic to the canaries, staging site built and published, live build must equal the local build | yes |
| `smoke` | signed-out checks | no |
| `e2e` | Sidhu's suite with writes and database proofs, against the exact build | test rows only |
| `rollback` | traffic back to the recorded revisions; prints the site and database steps | yes |

Two locks. The worktree must be exactly the commit with nothing uncommitted. And every phase except `preflight`
refuses unless `STAGING_RELEASE_AUTHORIZED=<commit>` is set, which is how you approve one exact commit.

Still needed from the owner before `e2e` can pass:

1. **Five staging test accounts** and the fixtures (Sidhu's list plus `E2E_FIXTURE_VOICE_CANDIDATE_NAME`,
   `E2E_FIXTURE_VOICE_ID`, `E2E_FIXTURE_DELETE_STUDENT_ID`). Staging and production share Google Identity; the
   delete check removes its throwaway login for good. Five-role status stays 0 of 5 until then.
2. The release switch is already set on the staging gateway (not by me), so signed-in pages can open.
3. The 93 / 103 ledger question Sidhu raised is answered: the staging ledger records 92, 93, 95 to 98 and 100 to 105.

Known limits:

- A canary at 0% cannot be browser-tested: the site talks to whatever serves 100%. Browser proof comes after
  `switch`, with `rollback` ready.
- After a database rollback of 105 the ledger still lists it, so it will not re-apply by itself.
- The resend of pending login deletions rides on the accounts sync job. If that job is not scheduled on staging,
  a pending login stays locked (safe) until it runs.

## 4. Tests run locally

| Result | Check |
|---|---|
| PASS | Unit tests 157 of 157; typecheck; production build |
| PASS | Server function tests 189 of 189; type-check of all 35 functions |
| PASS | Accounts: self-delete 11 cases, removal rules 9, sync plan, token module |
| PASS | Migrations 105 and 106 **executed** on PostgreSQL (PGlite): 9 of 9, both rollbacks applied, re-apply works |
| PASS | Mutation check: with the consent rules removed, the consent and voice-play tests fail |
| PASS | Sidhu's suite tests 9 of 9 on the merged tree |
| PASS | Migrations check 108 / 0 problems; secret scan 0; legacy guard 0; pipeline script syntax |
| SKIP in CI | `s34_migration_105.test.mjs` needs PGlite, which is not a repository dependency. It skips, it does not pass. |
| NOT RUN | Any staging deployment, migration, signed-in browser test, real email, real audio play, real deletion |
