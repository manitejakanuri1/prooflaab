# S34: every dashboard control does something real

Date: 10 October 2026. Base: `5bef957` (the launch candidate `c2a4fe8` plus Sidhu's S31 AI-first review).
Branch: `feat/teja-claude-s34-live-functionality-2026-10-10`.

> **Updated the same day by [`S34-RELEASE-PREPARATION.md`](S34-RELEASE-PREPARATION.md):** Frames, Subscribe and Blog
> were removed; all stored files are now deleted on self-deletion; the staging command in section 5 is replaced by
> the phased pipeline. **Migration 105 as described here has a bug, repaired by migration 106.** Read that file
> for the current state.

**Short answer.** Every control on the four dashboards was listed (648). Nine had nothing behind them. Seven are
now real, built end to end in code. Two were left for the owner to decide. **Nothing here has run against a live
database or a signed-in browser yet**, so no control is called "verified": that needs the staging run in section 5
and the signed-in checks in section 6.

Nothing was deployed. Production, `main`, the staging traffic split and the release switch are untouched.

## 1. The inventory

Full list, one row per control: [`S34-BUTTON-INVENTORY.tsv`](S34-BUTTON-INVENTORY.tsv)
(file, line, kind, label, how it is wired, verdict). Made by `python scripts/dev-tools/s34_button_inventory.py . <out>`;
run it again after any screen change.

| Area | Controls | With nothing behind them (before) | Now |
|---|---|---|---|
| Student | 181 | 1: Delete Account | 0 |
| College | 81 | 0 | 0 |
| Company | 47 | 1: Play on a voice explanation | 0 (1 kept disabled on purpose, below) |
| Admin | 230 | 4: Email Templates, Notification Rules, View Announcement, "All Announcements" | 0 |
| Shared photo window | 7 | 1: Frames | 1 (owner decision) |
| Sign-in, landing page, public portfolio | 102 | 2: Subscribe, Blog (landing page, not a dashboard) | 2 (owner decision) |
| **Total** | **648** | **9** | **3 left, all listed below** |

What the inventory is, and is not:

- It is a reading of the source: every button, link, switch, menu item, form, file input and audio player, and
  whether it has an action. That is how the nine were found.
- A second check compared every database table, database function, server function and `/api` path the screens
  call with what the repository defines: 47 tables, 75 database functions, 31 server functions, 16 paths.
  Result: no screen calls a server function that does not exist. Two database functions the screens call
  (`touch_my_activity`, `complete_own_wizard`) are in the live schema snapshot but in no migration file; they
  predate the migration folder. Confirm on staging that they answer.
- It is **not** a click-through. A control with a handler can still fail against real data. Only section 6
  proves that.

### Left as they are (owner to decide)

| Control | Why it was not changed |
|---|---|
| Company settings: Delete Account (disabled) | The screen already says why: closing a company removes its jobs and sponsored work, so an administrator does it. Honest as it stands. Building company self-deletion needs a decision on what happens to Lots it set for students. |
| Photo window: Frames (disabled) | No such feature exists. The honest fix is to remove the button, and removing things needs your yes. |
| Landing page: Subscribe box, Blog link | Not a dashboard. There is no mailing list and no blog. Remove both, or say what they should do. |
| Student tasks: "Under Review" (disabled) | A status label drawn as a button. Correct behaviour. |

## 2. What was built

| # | Control | Screen to database path | Permission, consent, confirmation, record |
|---|---|---|---|
| 1 | **Student: Delete Account** | Settings, Danger Zone, dialog, `POST /api/accounts/remove` (existing gateway path), accounts service, `remove_students(..., 'self')`, login deleted, browser signed out | Only a student, only their own id, only after typing `DELETE` (checked in the browser, the service and the database). Record: one `removed_students` row with reason `self`. No copy of the work is kept. Voice audio is deleted by the daily job. |
| 2 | **Admin: Email Templates** | System Settings, dialog, `admin_save_email_template`, table `email_templates`, read by `send-onboarding-email` | Admin only (checked in the database). Plain text only: subject and opening words; the button and its link cannot be edited. Each save is written to `security_events`. |
| 3 | **Admin: Notification Rules** | System Settings, dialog, `admin_set_notification_rule`, table `notification_rules`, trigger on `notifications` | Admin only. Switching a kind off stops the database creating it, wherever it comes from. Each change is written to `security_events`. Default: everything stays on. |
| 4 | **Company: Voice Play** | Proof Profile, Play, `POST /api/functions/company-voice-play`, `company_voice_recording`, private bucket, audio bytes | Verified company only; student discoverable; recording scored, current and not withdrawn; **and the student switched on "Let companies listen"** (new switch on the student Privacy screen, off for everyone). Each listen is written to `security_events` with company, student and recording. The browser never gets a link or a path. |
| 5 | Student: "Let companies listen to your recordings" | Privacy screen, switch, `set_share_voice_audio` | The consent for item 4. Off by default. Each change is recorded. |
| 6 | Admin: View Announcement | Announcements, row menu, read-only window | Shows what is already loaded; no new call. |
| 7 | Admin: "All Announcements" | Was a button with no action; now a plain count line | none needed |

### Files

| Part | Files |
|---|---|
| Database | `migration/105-live-controls.sql`, `migration/105-rollback-live-controls.sql`, the copy in `supabase/migrations/` |
| Accounts service | `accounts/server.py` (`removal_reason`), `accounts/test_removal_reason.py` |
| Server functions | new `company-voice-play`; `send-onboarding-email` (reads the template); `scheduled-job` (deletes audio of self-deleted accounts during the daily prune); `_shared/email-template.ts` + test; `functions-service/main.ts` (35 functions now) |
| Screens | `DeleteAccountDialog.tsx`, `EmailTemplatesDialog.tsx`, `NotificationRulesDialog.tsx`, `VoicePlayButton.tsx`, and small edits in `StudentSettingsPage`, `StudentPrivacy`, `SystemSettings`, `ProofProfile`, `ManageAnnouncementsPage`, `src/recruiter/data.ts`, `types.ts` |
| Release gates | `scripts/rpc_manifest.json` (7 new database functions classified), `.github/workflows/deploy.yml` (one test added) |
| Staging | `scripts/dev-tools/s34_staging_batch.sh` |

The gateway (`web-bff/`) was not changed: all four features use paths it already allows.

## 3. Choices made for you (say if any is wrong)

1. **Delete Account keeps no copy.** A college or admin removal keeps a full snapshot so it can be explained
   later. A student deleting their own account keeps only: who, when, college, email and name (the proof that
   they asked), and the list of audio files to delete.
2. **Email and name are kept in that record.** Without them nobody can later answer "did this person delete
   their account?". Say so if the record should hold the id only.
3. **Audio sharing is opt-in.** No company can play any recording until the student switches it on. Existing
   students are all off.
4. **Templates change wording, not layout.** Admins cannot enter HTML or links. That removes the risk of an
   admin account being used to send harmful mail from your domain.
5. **Resume files and profile photos of a self-deleted account are not yet deleted from storage.** Only voice
   audio is. The rows that point to them are gone, so nothing can reach them through the app, but the files
   remain in the private bucket. This is the one known gap in Delete Account.
6. **Welcome emails are still not being sent at all** (no mail provider key is set, as before). Templates are
   saved and used the moment sending is switched on. That is an existing gap, not a new one.

## 4. What was tested

| Result | Check |
|---|---|
| PASS | Unit tests: 156 of 156 (3 new: delete-account request rules) |
| PASS | TypeScript typecheck; production build |
| PASS | Server function tests: 186 of 186 (2 new: template text can never become markup, a link or a mail header) |
| PASS | Type-check of all 35 server functions |
| PASS | Accounts tests, including 9 new rules (a student can remove only themselves, only with the word) |
| PASS | `migrations.py check`: 107 migrations, 0 problems |
| PASS | Migration 105 and its rollback parse with the real PostgreSQL parser: 42 and 14 statements, 9 function bodies |
| PASS | Secret scan 0 findings; legacy guard 0 occurrences |
| PASS | Staging batch script: syntax, refuses a wrong commit, its read-only lookups return today's real values |
| **NOT RUN** | **Migration 105 has never been executed on a database.** Parsing proves grammar, not behaviour. Its self-check block runs on staging. |
| **NOT RUN** | Any signed-in browser test of the new screens. There are still no agreed test logins (five-role status stays 0 of 5). |
| **NOT RUN** | Real email, real audio play, real account deletion. |

The unit tests replace the network with a stand-in. They are not browser tests and are not counted as such.

## 5. Staging run (nothing below has been run)

One command, staging only, from a clean checkout of the commit:

```bash
cd /c/Users/manit/Downloads/prooflabai-mvp/prooflabai-claude-s34
bash scripts/dev-tools/s34_staging_batch.sh all <COMMIT ID>
```

| Step | What it does | Traffic moved? |
|---|---|---|
| 1 | Writes the current revisions and site version to `e2e-out/s34-staging/rollback.env` | no |
| 2 | Backup of the staging database | no |
| 3 | Migrations 104 and 105 through the ledger (skipped if already applied) | no |
| 4 | Builds functions, accounts and gateway from the commit; deploys each at 0% with tag `s34` | no |
| 5 | New revisions must answer: functions 35 of 35, accounts ready, gateway healthy, both new doors refuse a caller with no login | no |
| 6 | Traffic to the `s34` revisions | **yes** |
| 7 | Builds and publishes the staging site | **yes** |
| 8 | Checks that need no login | no |

To stop before anything visible changes, run `prepare` instead of `all`, then `switch`, then `smoke`.
Undo: `bash scripts/dev-tools/s34_staging_batch.sh rollback <COMMIT ID>` puts traffic back and prints the site
and database steps.

Things to know before saying yes:

- Staging has moved since 9 October: functions traffic is on `00075-git`, and newer revisions exist that this
  work did not create (`00078-zos` for functions, `00007-pim` for the gateway). The script records whatever is
  serving when it starts, so rollback returns to exactly that.
- The release switch is not touched. If it is off on staging, signed-in pages on the staging site stay closed
  and section 6 cannot be done there until you switch it on.
- Staging and production **share Google Identity**. Deleting a staging test student deletes that login for good.
  Use a throwaway student for check D1, never the smoke student.
- Cost: three image builds and one site build. No paid AI call.

## 6. Signed-in checks still owed (this is what "verified" means)

Each needs a real login on staging and a look at the database row afterwards.

| # | Who | Do | Proof |
|---|---|---|---|
| D1 | Throwaway student | Settings, Delete Account, type `DELETE` | Signed out; cannot sign in again; `removed_students` has a `self` row; no `student_profiles` row; next day `files_purged_at` is set |
| D2 | Student | Type `delete` in small letters | Button stays disabled |
| D3 | Company; a student naming another student | Call the same path with that student id and the word | 403, nobody removed. (A college removing its own student is the existing, allowed removal and is not part of this check.) |
| E1 | Admin | Save a student template; reload | Wording still there; `email_templates` row; `security_events` row |
| E2 | Admin | "Use built-in wording" | Row gone |
| E3 | Non-admin | Call `admin_save_email_template` | Refused |
| N1 | Admin | Switch `weekly_progress` off; run the weekly job on staging | No new notification of that kind; switch on, run again, they appear |
| V1 | Company (verified) | Open a student who has **not** switched sharing on | No Play button; direct call answers 404 |
| V2 | Student, then company | Student switches sharing on; company presses Play | Audio plays; `security_events` has `company_voice_played` |
| V3 | Student | Deletes that recording; company presses Play again | 404, no audio |
| V4 | Unverified company, college, student | Direct call to `company-voice-play` | 404 |
| A1 | Admin | Announcements, View | Window shows the text |

Until these pass, the honest status is: **built and unit-tested, not verified live.**
