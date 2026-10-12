# S38 independent security re-review of TEJA `7704a98` (12 Oct 2026)

Reviewed: TEJA `7704a982be87baa926229deb416b6d78e0cf328f` (S36 fixes), against every finding in `S36-SECURITY-QA.md`.
Review branch: `fix/sidhu-s38-security-rereview-2026-10-12`, based on `7704a98`, own worktree.
Untouched: TEJA's worktree, the S36 branch (`6f70b96`), the S37 branch (`a437e36`), every older worktree.
Not done: no deploy, no migration applied, no traffic change, no IAM or bucket change, no account created or deleted.
Live checks were read-only: `gcloud run services describe`, bucket IAM and settings, and object **counts**
(no object names or user ids were printed or saved).

## Answer first

| S36 finding | Verdict | Evidence |
|---|---|---|
| S36-01 functions cannot delete files | **PASS** (code) | `--allow-write=/mnt` only. Production mounts sit at `/mnt/private`, `/mnt/public`, inside that scope. Removing or widening the flag fails a test. |
| S36-02 missing mount recorded as purged | **PASS** | A mount folder that cannot be seen is a failure. The row is never marked. Tested with fakes, a real missing path, and the job wiring (new). |
| S36-03 direct consent write not audited | **PASS** | The trigger writes one record per real change, ON and OFF, with who made it. A no-op writes nothing. |
| S36-04 trigger drops protected notices | **PASS** | The trigger knows the list. 107 switches old "off" rows back on (now tested). |
| S36-05 login id, email, name kept for ever | **PASS** for the login id / **BLOCKED** (owner) for email and name | The login id goes when `login_deleted_at` is set, for self rows only. Email and name have no end date: owner decision. |
| S36-06 retry starvation, 150 s sleep | **PASS** | 10 rows a run, one try each, no sleep, least-tried first. `removed_at` exists (migration 17). |
| S36-06b rows with no login id | **PASS** | Counted, logged `SELF DELETE NEEDS REVIEW`, moved back in the queue, never marked done. |
| S36-07 protected notices look switchable | **PASS** | Switch disabled; the UI list equals the SQL list (now tested). |

**New, critical for production (P1, privacy):** S38-01 below. **Not a blocker for a staging rehearsal.**

## New findings

| ID | Sev | Finding | Evidence | Fix (owner / TEJA) |
|---|---|---|---|---|
| **S38-01** | **P1 (production privacy)** | Both **production** buckets have **Object Versioning ON and no lifecycle rule**. Deleting through the mount only turns each object into a noncurrent version. Those are kept with no end date. So the purge would set `files_purged_at` while every resume, voice file and photo can still be restored. On top of that, soft delete keeps every deleted object for 7 days (604800 s, all four buckets). | `gcloud storage buckets describe`: prod private and public `versioning_enabled=True`, lifecycle none. Prod private already holds **8 noncurrent versions** (160 versions, 152 live). Staging buckets: versioning off. | Owner decision, infrastructure. Either turn versioning off, or add a lifecycle rule that deletes noncurrent versions after a period **the owner chooses**. Or the purge deletes every generation through the API. Then say the real period on the screen and in the privacy text. |
| S38-02 | P2 (tests) | **No workflow ran any of the S36 proofs.** `deploy.yml` runs `_shared/owner-files_test.ts`, but not the PGlite tests of 105-107, `sidhu_s36_security`, the retry test, or the Dockerfile check. "Fails if a fix is lost" held only on a laptop. | `deploy.yml` steps; mutation run below. | **Fixed here**: new workflow `s38-security-regression.yml`. It refuses skipped tests. |
| S38-03 | P3 (UX, truth) | The "login pending" screen said "Your profile, work and **recordings are deleted**". The files are only removed by the next daily job. On staging they are never removed (no mount), and in production see S38-01. | `DeleteAccountDialog.tsx:50` | **Fixed here** (wording only): "Your uploaded files (resume, photo and voice recordings) are removed by a daily clean-up." Same sentence added to the confirm text. |
| S38-04 | P4 | The file purge reads 50 pending rows **with no order**, the same pattern as S36-06. Today a permanent failure is unlikely in production (the robot is objectAdmin), and on staging every row fails anyway. It has no attempt counter. | `scheduled-job/index.ts:104` | Later: `order('removed_at')` plus an attempt counter. Not needed for the rehearsal. |
| S38-05 | P4 (note) | Mount detection checks only that the mount folder exists. That is correct for Cloud Run: the path exists only when a volume is mounted, and the image has no `/mnt/staging-*` folder. It also relies on **implicit directories**, which Cloud Run turns on by default. Staging has 4 owner folders with no folder object, so `implicit-dirs=false` would make them look "already gone". | Cloud Run docs; object counts | Never set `implicit-dirs=false` on the functions mount. Written down here; no code change. |

## Files: can a real mounted bucket be purged? (read-only facts)

| Fact | Production | Staging |
|---|---|---|
| functions volumes | `private` → `/mnt/private`, `public` → `/mnt/public` (gcsfuse, no mount options, not read-only) | **none**; env says `/mnt/staging-private`, `/mnt/staging-public` |
| functions robot on the buckets | `roles/storage.objectAdmin`, **bucket-scoped**, both prod buckets; no project storage role | **no role on the staging buckets** |
| Object Versioning | **ON**, no lifecycle (S38-01) | off |
| Soft delete | 7 days | 7 days |

So:
1. **A missing mount cannot give a false purge.** The code refuses, and the new job-wiring test fails if "skip on failure, then mark" is changed.
2. **Production can delete, with bucket-scoped rights.** But because of versioning (S38-01) the content is only *hidden*, not gone.
3. **Staging cannot prove a purge.** Mounting the staging buckets alone is not enough: the staging functions robot also needs `objectAdmin` (or a narrower delete role) on both staging buckets. Until then, every staging self-deletion stays `files_purged_at = null` and logs `JOB SANITY` daily. That is safe.
4. **Still not tested anywhere:** `Deno.remove(recursive)` on a real gcsfuse mount. That includes a folder with no folder object, and how gcsfuse answers `rmdir` on an implicit folder. Only a rehearsal with a mounted staging bucket can prove it. **BLOCKED** until the owner mounts and grants on staging.

## Migration 107: review

| Check | Result |
|---|---|
| Consent guard: only the student can switch ON; anyone who may edit can switch OFF | PASS (PGlite) |
| Audit: one record per change, ON and OFF, with who; a no-op writes none; the RPC no longer double-writes | PASS (new tests) |
| Protected notices: RPC refuses, trigger never drops, old "off" rows switched on | PASS (new test for the last) |
| Login id dropped on `login_deleted_at`, self rows only, kept while attempts fail | PASS (new test) |
| Retry order column `login_delete_attempts`, default 0, service_role-only update | PASS |
| RLS / grants: `removed_students` unreadable by browser roles; internal functions not callable by `authenticated`; owner, SECURITY DEFINER and ACL of `remove_students` unchanged (self-check) | PASS |
| 107 before 106 refused as a whole; 106 and 107 each idempotent; rollback then re-apply | PASS |
| Rollback switches every student's consent OFF (safety first, documented) and keeps the new columns | PASS, by design |
| `migration/107…` equals `supabase/migrations/20261103005700…` byte for byte | PASS |

## Tests: do they catch a lost fix? (mutation run)

Each fix was reverted on its own; the suite was run; the file was restored.

| Reverted | Caught? |
|---|---|
| `--allow-write=/mnt` removed / widened to `--allow-write` | yes / yes |
| mount check removed | yes |
| consent audit insert removed; guard opened to admins; RPC double-writes; no-op audited | yes (all) |
| trigger ignores protected list; RPC allows protected off | yes / yes |
| re-enable of old "off" protected rows removed | **was not caught → now caught (S38)** |
| login id not dropped | yes |
| retry: order removed; attempts not counted; sleep back; no-id rows not counted | yes (all) |
| idempotency marker removed | yes |
| purge marks even on failure / `continue` removed / reads non-self rows / reads already-purged rows | **was not caught (no test) → now caught (S38)** |
| UI lock of protected notices removed | **was not caught → now caught (S38)** |
| Not caught, accepted: "forget login id" for every reason (non-self rows never set `login_deleted_at`) | — |

## Local results on this branch

| Suite | Result |
|---|---|
| `s34_migration_105` + `sidhu_s34_remove_students` + `sidhu_s36_security` (PGlite 0.2.17) | 21 / 21, 0 skipped |
| **New** `sidhu_s38_rereview.test.mjs` | 7 / 7, 0 skipped (run 5×, stable) |
| `sidhu_s36_self_delete_retry_test.py` | 3 / 3 |
| `sidhu_s36_owner_files_test.ts` + `_shared/owner-files_test.ts` | 8 / 8 |
| `accounts/test_self_delete.py` | 11 cases |
| migrations check / legacy guard / secret scan | 109, 0 problems / 0 / 0 |

GitHub Actions results are recorded in the commit/PR, not here.

## Retention decisions still open (no period is proposed here)

1. How long email and full name stay in a self-deletion record (`removed_students`). Today: no end date.
2. How long noncurrent object versions stay in the production buckets (S38-01). Today: no end date.
3. Whether the 7-day soft delete stays, and whether the privacy text mentions it.
4. `security_events` consent records keep the student id after the account is gone (needed as proof of consent; the period is the owner's).

## Staging rehearsal: is `7704a98` safe?

**Yes, for an owner-approved staging rehearsal** (with or without this branch's test and wording changes):
- Every staging failure mode is "stays pending and is reported", never "recorded as done".
- The staging accounts robot cannot manage logins, so a self-deletion there ends in "Nothing was changed".
- Staging buckets have versioning off, so S38-01 does not apply there.

**Not yet for production self-deletion.** Blockers, in order:
1. S38-01: owner decides versioning / lifecycle for the production buckets (or the purge deletes all generations).
2. Owner: retention period for email and name (S36-05) and for noncurrent versions.
3. Owner: mount both staging buckets on staging functions **and** grant its robot delete rights on them. Then rehearse one real self-deletion on a disposable staging student and prove `files_purged_at` is set **and** `gcloud storage ls -a` shows no object, live or noncurrent, under that id.
4. Apply 106 then 107 on staging (approved run), then the S34 batch preflight.
5. Merge this branch's workflow so the proofs run in CI.

Tests passing is not a production GO.
