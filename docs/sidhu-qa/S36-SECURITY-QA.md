# S36 independent security QA: migrations 105 + 106 + 107 (9 Oct 2026)

Reviewed: TEJA `5a7a8d36a2a56783b5fd054f3d9b3a07621bafb1` (branch `fix/teja-claude-s36-staging-blockers-2026-10-10`).
QA branch: `fix/sidhu-s36-security-qa-2026-10-10` (own worktree; TEJA's worktree untouched).
Not done: no migration applied, no cloud or IAM change, no deploy, no account created or deleted.
Live checks were read-only: one `begin transaction read only … rollback` query on staging, and `gcloud … describe`.

## Answer first

| # | Security area | Verdict | Why |
|---|---|---|---|
| 1 | Student removal and backup | **PASS** (code) / **staging still broken** | 105+106: every removal path works, the backup keeps graded work, and the self-deletion keeps no copy. Staging today: ledger ends at 105, and `remove_students` still reads the dropped table. |
| 2 | Identity deletion and retry persistence | **PASS**, 2 findings (P3) | Disable-first order is sound; the login id is now kept; the retry is safe to repeat. Findings: retry starvation (S36-06), and rows without a login id stay pending forever (S36-06b). |
| 3 | Audio-consent authorization and trigger | **PASS**, 1 finding (P3) | Only the student can switch it on (admin, college, server and forged claims all refused). Gap: a direct table write is not audited (S36-03). |
| 4 | Protected notification rules | **PASS**, 1 note (P4) | Admin RPC refuses the 3 protected types; existing "off" rows are switched back on. The drop trigger itself does not know the list (S36-04, defence in depth only: no role can write the table). |
| 5 | Function owner, grants, RLS | **PASS** | Self-checks verified owner, SECURITY DEFINER, config, ACL and grants. Tested: browser roles cannot run `remove_students` or `company_voice_recording`, or read rules or templates. |
| 6 | Data retention and privacy | **FAIL** | **S36-01: a deleted student's files are never deleted** (the functions image has no write permission). **S36-02: on staging the purge would be recorded as done with nothing deleted** (no bucket mounted). S36-05: email, name and login id are kept with no end date. |
| 7 | Rollback and recovery | **PASS** | 107 before 106 is refused as a whole; 106 and 107 can each run twice; 107 rollback and re-apply work; 106 has no rollback (correct: undoing it re-breaks removal). |

**Merge recommendation:**
- **Migrations 106 + 107: GO for staging**, in that order (106 first; 107 refuses without it).
- **Code at `5a7a8d3`: OK to keep on the release line.**
- **Do not ship self-deletion to production until S36-01 / S36-02 are fixed.** The screen tells the student "your profile, work and recordings are deleted", but their stored files are not deleted.
- **This QA branch** (tests, suite and report only; no app code): merge into the S36 line.

## Reproducible failures

Every REPRO test **passes while the finding exists**. Once a finding is fixed, its test fails and should be turned into a normal test.

| ID | Sev | Finding | Reproduce |
|---|---|---|---|
| **S36-01** | **P1 (privacy)** | `functions-service/Dockerfile` runs `deno run --allow-net --allow-env --allow-read --allow-import`, with no `--allow-write`. `removeOwnerFiles` → `Deno.remove` throws `NotCapable` for every folder → `files_purged_at` is never set → a self-deleted student's resumes, voice audio and photo stay in the buckets. The daily prune logs `JOB SANITY` for every such row, every day. | `deno test --allow-read --allow-write --allow-env scripts/dev-tools/sidhu_s36_owner_files_test.ts` (REPRO S36-01 ×2) |
| **S36-02** | **P1 (privacy, staging)** | Staging functions (including S34 revision `00080-wow`) has `PRIVATE_MOUNT` / `PUBLIC_MOUNT` set but **no volumes** (gcloud describe). `Deno.remove` on a missing path → `NotFound` → read as "already gone" → **marked purged while the files remain**. This would hit staging as soon as S36-01 is fixed by adding `--allow-write`. `s34_staging_batch.sh` checks only the variable names, so it says PASS. | same file, REPRO S36-02 |
| S36-03 | P3 | Consent can be switched on by the student's own direct `PATCH /api/db/student_profiles` (staging: `authenticated` has column UPDATE plus the `student_profiles_own_update` policy). This is still the student's own choice, but no `security_events` row is written. The RPC path is audited. | `sidhu_s36_security.test.mjs` REPRO S36-03 |
| S36-04 | P4 | `apply_notification_rules()` drops any type whose rule row is off, so the protection lives only in the admin RPC. No browser or server role can write the table, so only a future migration could cause this. | REPRO S36-04 |
| S36-05 | P3 (owner decision) | After `login_deleted_at` is set, the self-deletion record still holds email, full name and the Google login id. No job ever clears them. | REPRO S36-05 |
| S36-06 | P3 | `retry_pending` reads 50 unordered rows. 50 permanently failing logins starve every newer row. Each run also sleeps 50 × 3 s = **150 s inside the console-sync request**. | `python scripts/dev-tools/sidhu_s36_self_delete_retry_test.py` |
| S36-06b | P3 | A self row without a login id (none exist today: staging has 0 self rows) stays pending forever and is retried on every run. | same |
| S36-07 | P3 (UX) | The Notification Rules dialog shows the 3 protected types as normal switches. Turning one off gives a server error toast; it is not shown as locked. | code: `NotificationRulesDialog.tsx:69` |

**Suggested fixes (TEJA):**
- **S36-01:** add `--allow-write=/mnt/private,/mnt/public` to the CMD.
- **S36-02:** in `removeOwnerFiles`, refuse (report failure) when `<mount>/<bucket>` does not exist; mount the buckets on staging functions, or leave staging rows pending; and make the batch script check the volumes, not only the variable names.
- **S36-03:** write the audit event inside `guard_share_voice_audio()`, or revoke the column UPDATE.
- **S36-04:** make the trigger skip the protected types.
- **S36-05:** clear the login id once `login_deleted_at` is set, and set a retention period.
- **S36-06:** order by `removed_at desc`, add an attempt counter, and move the retry out of the sync request.

## Staging facts (read-only, 9 Oct 2026)

| Fact | Value |
|---|---|
| Ledger | ends at `105-live-controls` (106 and 107 **not applied**) |
| `remove_students` reads the dropped table | **true**: removal still broken on staging |
| `removed_students` rows with reason `self` | 0 (no pending login deletions or file purges exist) |
| Students with consent on | 0 |
| Consent guard trigger | absent (107 not applied) |
| `student_profiles` policies | `own_insert`, `own_update`, `college_update`, `select` |
| Staging accounts robot roles | `roles/logging.logWriter` only: **it cannot disable or delete logins**, so self-deletion on staging always ends in "Nothing was changed" (safe, by design) |
| Staging functions volumes | **none** (production functions mounts both buckets) |
| Staging functions email variables | `RESEND_API_KEY` and `EMAIL_FROM` present (names only) |

## Regression tests (run independently at `5a7a8d3`)

| Suite | Result |
|---|---|
| `migrations.py check` | 109 migrations, 0 problems |
| Atomic migration guard | 6 / 6 |
| Frontend unit (`src/lib/*.test.ts`) | 157 / 157 |
| TypeScript typecheck | clean |
| Server functions (Deno `_shared/`, `transcription-reap/`) | 189 / 189 |
| Web BFF | 110 / 110 |
| Files service | 16 / 16 |
| `deno check` of every server function | clean |
| Accounts (incl. `test_self_delete.py` 11 cases, sync plan) | all pass |
| TEJA `s34_migration_105.test.mjs` (PGlite, real PostgreSQL 16) | 9 / 9 |
| `sidhu_s34_remove_students.test.mjs` | 5 / 5 |
| **New** `sidhu_s36_security.test.mjs` (PGlite) | 7 / 7 (4 checks + 3 REPRO) |
| **New** `sidhu_s36_self_delete_retry_test.py` | 3 / 3 (1 check + 2 REPRO) |
| **New** `sidhu_s36_owner_files_test.ts` | 3 / 3 REPRO |
| Live suite unit tests `sidhu_s32_live_e2e.test.mjs` | 16 / 16 |
| Legacy guard / secret scan | 0 / 0 |

## The E2E recipes: review and changes

The suite had 12 recipes; it now has **14**.

**Fixed (my own suite had drifted):**
- `student-delete-own-account` still checked the old `login_failures` field. S36 answers `login_deleted`, so a deletion that left the login behind could have passed. It now requires `login_deleted === true` and the DB proof `login_deleted_at is not null`.
- On staging the service refuses with "Nothing was changed" (the robot has no Identity rights). The recipe now proves that safe failure (the account still signs in) and reports **BLOCKED**, never PASS.
- `admin-notification-rule-off-on` refuses a protected fixture type.

**Added:**
- `admin-notification-protected-refused`: switching `review_outcome` off must be refused, and the DB must still show it on.
- `admin-email-send-test`: clicks **Send test to me** and requires HTTP 200 `success:true`, a provider message id, and the "Test email sent" toast. Then it checks **actual delivery** through the provider's message status (`GET /emails/{id}` with `E2E_RESEND_READ_KEY`):
  - `delivered` → PASS
  - bounced or complained → FAIL
  - no read key, or no delivery within 120 s → **BLOCKED** ("accepted ≠ delivered")
  - `skipped` (no provider key) → FAIL

**Still not covered (stays BLOCKED / NOT_TESTED):**
1. Inbox content of the test email (rendered wording). The provider status proves delivery, not what the email looks like. Needs an inbox the suite can read.
2. That a switched-off notification type actually stops new notices. The recipe only toggles; a server action that creates a notice is needed.
3. The login-deletion retry and the daily file purge (server jobs; no browser path). They need a job run plus a DB check, and S36-01 must be fixed first.
4. A real self-deletion end to end. Impossible on staging by design; it needs an environment whose accounts service may manage logins, plus a disposable identity.
5. The audit gap of a direct consent write (S36-03), the voice-play rate limit, and a college switching consent off.
6. Older gaps unchanged: college Assign Task, CSV import, admin approve / suspend, voice recording, resume upload.

**Owner inputs needed for the new recipes:**
- `E2E_RESEND_READ_KEY` (a full-access Resend key, GitHub environment secret).
- An admin test account whose email is a real inbox.
