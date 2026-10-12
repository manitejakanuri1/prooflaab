# Identity lifecycle: Google login and the app account, for every role (13 Oct 2026)

Branch `fix/teja-identity-lifecycle-sync-2026-10-13`. Base: P0 `1db3c1a`, plus the T40 commits that were missing
from P0 (S38 `74c3a12`, the removal-table gate `213bf00`, which was never pushed). Migration **110**.

## 1. What was recovered and what is new

| Item | Where it came from | State on this branch |
|---|---|---|
| Student self-delete (disable → remove → delete, retry) | S34–S36 (`7704a98`), migration 105–107 | **kept**, unchanged; now also writes an outbox row |
| College/admin student removal (`/remove`, `remove_students`) | migrations 17, 106 | **kept**; failed Google deletes are now retried, not lost |
| Managed account create / rollback (`/create-user`, `/delete-user`) | `755ef91`, migration 98 | **kept**, unchanged |
| Session revocation on role/org change | migrations 101, 102, `4b0d799` | **kept**, unchanged |
| Student sync suspend/restore + guards | migrations 51, 55; `sync_plan.py` | **generalised** to all roles; every guard kept |
| S38 re-review: delete-dialog wording + CI gate | `74c3a12` (T40, not in P0) | **recovered** (merge) |
| Removal-table gate | `213bf00` (local only, never pushed) | **recovered** (merge). It failed `legacy_guard` (it names the dropped table): fixed with a reasoned allow entry |
| S39 UI freeze baseline | `s39-squad-regression.yml` compared to `7704a98` | moved to `74c3a12` (the reviewed S38 wording), else the recovered fix fails the freeze |
| Organisation approve/suspend states, managed invites | `a9b287e`, `a74a4da` | already in P0 (same content) |
| Atomic migration guard, Google key hardening, S39 hotfix | `d8e5e07`, `1a4d550`, `34f7bf2` | already in P0 (same or newer content) |
| Older Supabase-era branches / the July stash | `backup/pre-sync-*`, `fix/security-and-follows-normalization` | not recovered: they target the deleted Supabase stack |

New in this branch (no earlier implementation existed anywhere): the all-role ledger, the Console → app cut for
non-students, the non-student delete endpoint, the Google-side outbox with backoff, refusing old tickets in the file
service, and the shared-pool safety switch.

## 2. How it works

```
Google Console deletes/disables login ──► /sync (every 10 min)
    listing complete? not empty? drop below guard?  ──no──► ABORT, nothing changes (alert line)
    1st sighting  ─► identity_lifecycle: observed_missing      (no effect yet)
    ≥30 min later + still missing + exact lookup says gone/disabled + ≤3 this pass
                  ─► verified_missing, access_blocked=true
                       ├─ web_sessions of THAT account revoked (trigger)
                       ├─ API pre-request hook refuses old tickets   (account_is_suspended)
                       ├─ functions refuse within 30 s               (same function)
                       ├─ BFF sign-in / re-check refuse               (web_login_identity → identity_missing)
                       ├─ bridge issues no new ticket                 (resolve_account raises)
                       ├─ file service refuses old tickets            (account_access_ok, fail closed)
                       └─ student also suspended (hidden); nothing deleted
    same login id back and enabled ─► recovered: access restored, student un-suspended (only if WE suspended)

App delete ─► identity_lifecycle (app): access cut at once ─► data step ─► Google delete
    confirmed ─► completed     failed ─► pending, retry 1,2,4… min (max 6 h) ─► after 8 tries: failed (alert)
```

## 3. API contract (accounts service)

| Call | Who | Answer |
|---|---|---|
| `POST /delete-account {user_id?, confirm}` | signed-in (bridge ticket) | `200 {status: completed\|pending, login_deleted, records_kept: true}`; `403` forbidden / protected; `409` last admin / a student (use `/remove`); `404` no such account; `503` shared identity pool; `401` no ticket |
| `POST /remove` (unchanged shape) | college (own students), admin, student (self) | `200 {removed, login_failures, login_pending}`; `login_failures` now lists logins *not deleted yet* (they are retried) |
| `POST /sync[?dry_run=1]` | Scheduler (`x-webhook-secret`) | `200 {marked, verified, suspended, recovered, restored, skipped, …}`; `409` abnormal drop; `502` listing incomplete; forced dry run on a shared pool |

Database (service_role only): `identity_sync_accounts`, `identity_sync_apply`, `identity_request_deletion`,
`identity_record_student_removals`, `identity_due_deletions`, `identity_attempt_result`, `identity_lifecycle_health`.
Browser-callable: `account_access_ok()` (no arguments; answers for the ticket's own subject), `admin_identity_lifecycle(limit)`
(admins only; login ids shown as last 4 characters).

## 4. Per-role matrix

| | Student | College (TPO) | Company (startup) | Recruiter | Admin |
|---|---|---|---|---|---|
| Console delete/disable → access cut | yes + suspended | yes | yes | yes | yes |
| Same login id returns → restored | yes | yes | yes | yes | yes |
| New id, same email | new account; old stays cut | same | same | same | same |
| App delete by self | `/remove` + `DELETE` (data removed, backup row) | `/delete-account` + `DELETE` | same | same | same, not the last admin |
| App delete by others | own college's TPO, admin | admin | admin | admin | another admin, not the last |
| Data on app delete | removed (106 backup kept) | **kept** (retention) | **kept** | **kept** | **kept** |
| Organisation (college/company) | untouched | untouched | untouched | untouched | untouched |
| Protected test account | never cut, never deleted | same | same | same | same |
| Files | purge job (105) | kept | kept | kept | kept |

Deleting an organisation and all its people is a different action and is **not** built here.

## 5. Safety switches and limits

* `SHARED_IDENTITY`: a staging accounts service pointed at production's pool (`prooflab-508214`, no tenant) refuses
  every Google delete/disable, forces `/sync` to dry run and answers 503 to removals. Production is unaffected.
* Isolation: set `GCP_PROJECT` to the staging identity project (or `IDENTITY_TENANT`); every ledger row carries
  project + tenant and other scopes are never acted on.
* Instant Google delete events were assessed and **not** built: `onUserDeleted` exists only as a 1st-gen Cloud
  Functions trigger, needs a new public event surface, and does not fire for batch deletes. The 10-minute sync stays
  the mechanism; worst-case delay is about 40 minutes (grace 30 + interval 10). Lower `SYNC_GRACE_SECONDS` to shorten it.
* Old tickets: refused at once by the API and file service; within 30 s by functions.

## 6. Rollback

1. Put `accounts` (and `files`, optional) back on their previous revisions (traffic switch, no rebuild).
2. Apply `migration/110-rollback-identity-lifecycle-all-roles.sql` (keeps the ledger table as audit; hands any
   suspension back to `account_sync_missing`).
3. `notify pgrst, 'reload schema'` is at the end of the file.
