# S34 QA — migration 105 review, live controls, and the cloud-executable E2E procedure (10 Oct 2026)

Reviewed: TEJA `12906431115336442cc77cfb6933c077ca06f871` ("real actions behind the last dead controls (S34)"), one commit on `5bef957`.
QA branch: `fix/sidhu-s34-qa-live-e2e-2026-10-10` = `1290643` + S32 (cherry-picked) + this work.
No production access. On staging: read-only queries only. No users created or deleted. No deploys.

## Answer first

| Item | Result |
|---|---|
| S32 suite pushed | `fix/sidhu-s32-live-e2e-suite-2026-10-10` @ `840f667903cda0690abc364b7255499ab8ac6aa9` |
| **Migration 105** | **NO-GO as written. Already applied on staging (2026-10-09 11:42 UTC), and it breaks every student removal there now.** Fix forward with **106** (this branch). |
| Account deletion security | **Authorization: sound.** **Identity deletion: incomplete** (P1, §2) |
| Consent-based voice playback | **Sound** (verified company, student opt-in off by default, discoverable, scored, not withdrawn, uniform 404, audited) |
| Email templates / notification rules | Sound; one P2 on suppressible notification types |
| Exact S34 build on staging | **Not deployed.** The frontend is still `59235dd`; the S34 backends are **0%-traffic canaries**; the database is already at 105. |
| 93 / 103 discrepancy (from S31) | **Resolved: timing, not a conflict.** 93 was applied at 05:24 UTC and 103 at 05:32 UTC, both after my 04:26 / 04:31 UTC queries, on the same database. |
| Suite | Cloud-runnable (GitHub workflow), exact-build gate (frontend **and** backend), **12 recipes** (was 5), 14 / 14 unit tests |

## 1. Migration 105 — P0 regression (proven)

**What.** 105 re-creates `remove_students()` in full from an **older body**:
- its backup branch reads `public.proof_uploads`, **dropped by migration 66**;
- it no longer keeps `task_submissions` (**migration 65's** change).

PostgreSQL plans the whole `INSERT … CASE …` statement, so **every** call fails: a college or admin removing a student, the console sync, and the new student self-deletion.

```
ERROR: relation "public.proof_uploads" does not exist
```

**Proof.** `scripts/dev-tools/sidhu_s34_remove_students.test.mjs` runs on real PostgreSQL (PGlite) with 105's exact body, after migration 66's schema:

| Case | 105 alone | 105 + 106 |
|---|---|---|
| student deletes own account | ERROR | works |
| college removes its student | ERROR | works (backup keeps graded work again) |
| admin removes a student | ERROR | works |
| console sync | ERROR | works |
| 105's rules (self only for yourself; a college only for its own students) | — | still enforced |
| 106 applied twice | — | no change, privileges kept |

5 / 5 tests pass.

**Live state (read-only, staging, system id `7689116126323384336`):**
- ledger `105-live-controls e3b53f35…` applied at 11:42 UTC;
- `remove_students` **references `proof_uploads` = true, keeps `task_submissions` = false**;
- table `proof_uploads` **absent**.

Removal runs in the database, so it is **broken for live staging traffic now**, whatever code version serves the request.

**105's rollback has the same bug** (its restored body also reads `proof_uploads`). Rolling back does not repair staging.

The checksums of 93, 103, 104 and 105 on staging equal the repository files. 93 / 91 / 103 are intact in `record_task_submission`, and 104 is in `review_task_submission`.

**Fix: migration 106** (`migration/106-remove-students-restore-submissions-backup.sql`, identical mirror `supabase/migrations/20261103005600_*`, plus a rollback note):
- an **in-place, anchored** replacement of the dead `'proofs'` entry with 65's `'submissions'` entry, refused unless found exactly once;
- the self-check verifies owner, SECURITY DEFINER, config, grants and 105's self branch are unchanged, and that no `proof_uploads` remains;
- it cannot be a rollback: undoing it re-breaks removal.

**GO / NO-GO:**
- **105 alone: NO-GO** (staging: already applied, apply 106 now).
- **105 + 106 together: GO for staging**, then production in the same window. Never 105 without 106.

## 2. Account deletion and Identity

| Aspect | Finding |
|---|---|
| Who may delete | Sound. `accounts/server.py` takes the caller id from the verified token and allows `student` only for `ids == [caller]` with typed `DELETE`; the database re-checks `_ids = array[_by]`. Tested in 105+106 above. |
| **Identity deletion (P1)** | The database rows are deleted **first**; the Google Identity login is deleted afterwards. If that fails it is only logged and returned as `login_failures`. **For a self-deletion, 105 keeps no `provider_uid`**, so nothing remains to retry with. The browser (`deleteMyAccount.ts`) reports success on `removed === 1` even when the login was not deleted. **Result: an orphan login in the Identity pool that production shares.** It cannot open the app (no account row), but it is not erased. **Fix (TEJA):** keep `provider_uid` + `identity_deleted_at` in `removed_students` for self rows, retry undeleted logins in the daily prune, and tell the user "your login is being removed" when `login_failures` is not empty. |
| Retained personal data (owner decision) | A self-deleted student's **email and full name stay in `removed_students` indefinitely** (no purge). Decide the retention period for erasure requests. |
| Voice audio purge | Sound: files listed at deletion, removed by the daily prune, marked only after success, retried. It depends on 106 (removal must work first). |
| Sessions | Revoked by the existing access triggers on the cascaded delete. |

## 3. Other S34 controls

| Control | Finding |
|---|---|
| Company voice Play | `company-voice-play`: company id from the verified token; `company_voice_recording` (service-only) checks verified company, student opt-in (`share_voice_audio`, **off by default**), discoverable, scored, server transcript, authoritative, not withdrawn; one 404 for every refusal; audio streamed (no lasting URL); every listen in `security_events`. **Sound.** P3: the rate limit (120/h) is per IP, not per company. |
| `recruiter_proof_profile` `audio_shared` | In-place anchored patch; `p` is `select * into p` so the new column is visible. **Sound.** |
| Email templates | Admin-only RPCs; table not browser-readable; text escaped; subject newlines stripped (no header injection). **Sound.** |
| Notification rules | Admin-only; a trigger drops new notifications of a switched-off type. **P2:** any type can be switched off, including `review_outcome` and other notices students rely on. Add a list of types that may not be suppressed. |
| Admin View Announcement | read-only window (a SAFE control in the matrix) |

## 4. Staging deployment (read-only, 9 Oct ~12:00 UTC)

| Part | Serving 100% of traffic | S34 build |
|---|---|---|
| Frontend | `59235dd` (`index-BbfwBTK1.js`, 8 Oct) | **not deployed**; `1290643` builds to **`index-CbusH0zP.js`** |
| functions | `00075-git` (tag `s30v2`) | `00079-voc` (tag `s34`) at **0%**; `00078-zos` (tag `s31f`) at 0% |
| web-bff | `00004-9nn` | `00008-cud` (tag `s34`) at 0% |
| accounts | `00015-rpk` | `00016-tec` (tag `s34`) at 0% |
| Database | 104 and 105 applied | — |

The database is ahead of the code that serves traffic. The S34 canaries receive **no** user traffic, so a browser on the staging site exercises none of them. A live S34 test needs the S34 frontend (at least on a staging **preview channel**) and the S34 revisions holding traffic.

## 5. The suite: what changed for S34

- **Exact-build gate, both halves:**
  - frontend: `--expect-entry` (the workflow derives it by building the SHA);
  - backend: `--expect-revisions functions=…,web-bff=…,accounts=…`, each must hold **100%** traffic (read-only gcloud).
  - A mismatch exits 4; **unverified provenance can never exit 0**.
- **Staging preview channels** (`https://prooflab-staging--<channel>.web.app`) are accepted; look-alikes are refused.
- **Recipes: 12** (was 5):

  | Recipe | Effect | DB proof |
  |---|---|---|
  | student certification add → delete | self-cleaning | |
  | student written submission | | |
  | TPO send reminder | | |
  | company shortlist | | |
  | admin review approve | | |
  | student **voice consent** on → off | restores; refresh persistence | `security_events` |
  | student **portfolio visibility** flip → restore | | |
  | admin **email template** save → built-in | refuses to touch a real saved template | |
  | admin **notification rule** off → on | refuses if already off | |
  | company **voice Play** with consent | | `company_voice_played` row |
  | company voice Play **without consent** | must 404 | no audit row |
  | **student delete own account** | **destructive**; separate `--allow-destructive` gate and an owner-approved **disposable** identity that is not a role account; checks removal, that the Identity login was deleted, and that signing in again is refused | |

- `.github/workflows/staging-live-e2e.yml`:
  - triggered **only** by manual dispatch or a pushed `qa/staging-e2e-*` branch (never by this branch or `main`; checked);
  - GitHub environment `staging-e2e` (owner adds reviewers and secrets);
  - builds the expected SHA to get its entry;
  - installs Chromium, runs the suite, uploads the matrix and screenshots;
  - no deploy step, no production target.
- Every unrecipe'd WRITE / READ / UNSURE control stays **BLOCKED**, and every never-reached row stays **NOT_TESTED**. Nothing untested is PASS.

Live now (anonymous, read-only, exact S34 expectations): **provenance MISMATCH (frontend and backend), exit 4**; 100 / 100 signed-out screen rows pass on the *current* (non-S34) build; 1,190 rows NOT_TESTED.

## 6. The single cloud-executable QA procedure

1. **Repair staging data paths:** review and apply **106** to staging through the ledger (`staging_migrate.sh`). Confirm with a read-only check that `remove_students` reads no `proof_uploads`.
2. **Deploy the exact build to staging:**
   - the S34 frontend to Hosting (or a staging preview channel);
   - move traffic to the S34 revisions;
   - label each deploy with `1290643` (or its successor that contains 106).
3. **Owner setup (once):**
   - approve five staging test accounts and one **disposable** student identity (staging shares Identity with production);
   - create the disposable fixtures (§5);
   - put all of them in the GitHub environment `staging-e2e`;
   - optionally create the read-only QA Google identity (`QA_WIF_PROVIDER`, `QA_SERVICE_ACCOUNT`) for revision provenance and `--db-verify`.
4. **Run:** push branch `qa/staging-e2e-<sha>` with `qa/staging-e2e-request.json` (copy `qa/staging-e2e-request.example.json`: `expected_sha`, `expect_revisions`, `allow_writes`, `db_verify`, `allow_destructive`). Once the workflow is on `main`, Actions → "Staging live E2E (QA)" → Run workflow also works.
5. **Read the result:**
   - exit 0 = every row PASS on the verified build;
   - 1 = a FAIL;
   - 2 = blocked / not tested / unverified;
   - 4 = wrong build.
   - The artifact holds `matrix.csv` (Role | Page | Control | Expected route | API | DB effect | Live result | Status) and screenshots.
   - I then review it against Cloud Run logs and a read-only database check.

## 7. Remaining blockers

1. **106 must be reviewed and applied on staging** (removal is broken there now). Then 105 + 106 together for production.
2. **The exact S34 build is not serving on staging** (frontend `59235dd`; S34 backends at 0%).
3. **No approved staging test accounts or disposable identity** (owner). Every signed-in row stays BLOCKED until they exist.
4. **Read-only QA Google identity** for CI provenance and DB proofs (owner/IAM). Note: the existing SQL runner job can run any SQL, so a QA identity allowed to execute it would hold more than read access. Prefer a separate job with a read-only database role.
5. **Identity-deletion retry** (P1, §2) and the **retention decision** for self-deleted students' email / name.
6. **Notification types that may not be suppressed** (P2).
7. Still no recipe (stays BLOCKED): college manual Assign Task, CSV import, admin approval / suspension, voice recording, resume upload.

## 8. Tests in this branch

| Check | Result |
|---|---|
| `sidhu_s34_remove_students.test.mjs` (PostgreSQL via PGlite) | 5 / 5 |
| `sidhu_s32_live_e2e.test.mjs` | 14 / 14 (+5 for S34: preview channels, backend provenance, unverified-never-OK, destructive gate, every recipe maps to a real control) |
| Plan on `1290643` | 1,290 rows; DEAD down from 20 to 8 (the rest are disabled-by-design controls) |
| Workflow YAML | parses; push trigger only matches `qa/staging-e2e-*` |
| `migrations.py check` / secret scan / legacy guard / diff check | see the commit message |
