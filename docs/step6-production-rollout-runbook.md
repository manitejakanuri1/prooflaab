# Step 6 production rollout runbook

Status: **not executed**. This is a checklist to follow when a production
rollout of the async transcription pipeline (Step 6B–6H) is explicitly
approved. Every fact below comes from read-only inspection of production
during Step 6G/6H — nothing in this document has been run.

Production and staging are the same GCP project (`prooflab-508214`).
"Production" resources below just means resources without a `staging-`
prefix, in that same project.

## 0a. Step 6M staging validation for migration 47

Checked whether migration 47's revoke (`authenticated`/`anon` lose
table-level `UPDATE` on `voice_explanations`) is already staging's live
state, and whether anything legitimate depends on the grant it removes:

| Check | Result | Evidence |
|---|---|---|
| No legitimate student flow needs direct `UPDATE` | **PASS** | Grepped every frontend call site against `voice_explanations` (`src/`): only `.select()`, `.insert()`, `.delete()` exist — never `.update()`. Grepped every edge function: all real updates go through `_shared/backend.ts`'s `createClient()`, which always mints a `service_role` token on this backend regardless of which key is passed in. |
| Frontend recording creation, reading, deletion remain supported | **PASS (unaffected)** | Migration 47 revokes only `UPDATE` — `INSERT`/`SELECT`/`DELETE` grants and the matching `voice_own_insert`/`voice_own_read`/`voice_own_delete` RLS policies are untouched by this migration. |
| Server-side voice scoring/transcription use authorized backend roles | **PASS** | `voice-score/index.ts` and `transcription-enqueue/index.ts` both write via the service-role-minting client. The `claim/complete/fail_*` RPCs are `SECURITY DEFINER` — the function (running as its owner) does the actual `UPDATE`, so the caller's own table grant is irrelevant to these RPCs regardless of who can call them. **Correction (Step 6N):** the sentence here previously said these are granted to `authenticated, service_role`, citing migration 41's *initial* grant only — migration 41's grant is superseded by migration 42's `revoke all ... from public, anon, authenticated` immediately followed by `grant execute ... to service_role` alone (same pattern in migration 45 for the voice-scoring functions). Live staging query confirms the corrected claim: `authenticated_can_exec = false`, `service_role_can_exec = true` for all seven job/scoring functions — see §0b. |
| Relevant functions/triggers/RLS don't depend on these two grants | **PASS** | No `CREATE POLICY ... FOR UPDATE` on `voice_explanations` exists in any migration (checked all of 01–47). Migration 43's `guard_voice_explanations_insert` trigger fires `BEFORE INSERT`, not `UPDATE`. |
| `service_role`/`prooflab_app` retain required privileges | **PASS** | Migration 47's `revoke` statement names only `authenticated, anon` — confirmed by reading the file. |
| Ordinary student `UPDATE` attempt is actually denied in staging | **NOT TESTED** | Attempted a real live test (sign in as the `t07` fixture, `PATCH` a `voice_explanations` row directly against the staging PostgREST API) but the credential this session had access to (`prooflab-staging-student-password`) did not match `t07`'s account (`INVALID_LOGIN_CREDENTIALS`) — did not retry with guessed credentials, since repeated login guesses against a real auth system is not acceptable. Falling back to indirect evidence instead of claiming this passed: staging's migration history (re-read via the existing `prooflab-staging-inspect4` job's logs) shows migration 42 — which contains the identical `revoke update ... from authenticated, anon` statement — already ran successfully in staging. A Postgres `REVOKE` is a hard deterministic guarantee once applied, not a probabilistic one, so this is strong indirect evidence, but it is not the same as a live, observed denial and is reported as such. |
| Synchronous voice scoring | **PASS (pre-existing evidence)** | 72/100 `browser`-sourced score, retested after every fix in Steps 6B–6K. |
| Asynchronous transcription + scoring | **PASS (pre-existing evidence)** | 55/100 `server`-sourced score through the full queue/worker/reap pipeline, retested after every fix in Steps 6B–6K. |
| Server-side updates continuing to work | **PASS (pre-existing evidence)** | Same evidence as the two rows above — these are the server-side updates in question. |

No unsafe permission was re-granted to `authenticated`/`anon` at any point
to run this check.

## 0b. Step 6N: live staging catalog audit + manual production plan for 47

Ran a real, live, read-only catalog query against staging using the
**existing** `prooflab-staging-inspect4` Cloud Run job (its execution-time
`--args` were overridden for this one run only — the job's permanent
definition, service account, and bound `STAGING_DB_URI` secret were not
changed; nothing new was created).

**1. Staging permissions, confirmed live:**

```
authenticated_update | anon_update
----------------------+-------------
 f                    | f
```
Table-level `UPDATE` on `voice_explanations` is held only by `postgres`
and `service_role`. No column-level `UPDATE` ACL exists. RLS: enabled
(`t`), not forced (`f`). Deployed policies: `voice_own_delete` (DELETE),
`voice_own_insert` (INSERT), `voice_own_read` (SELECT) — all
`{authenticated}`, none for `UPDATE`. This matches migration 42's
intended end-state exactly.

**2. Privileged function audit, all seven job/scoring functions:**

```
proname                       security_definer  owner     anon  authenticated  service_role  public
claim_transcription_job       t                 postgres  f     f              t             f
claim_transcription_recovery  t                 postgres  f     f              t             f
claim_voice_scoring           t                 postgres  f     f              t             f
complete_transcription_job    t                 postgres  f     f              t             f
complete_voice_scoring        t                 postgres  f     f              t             f
fail_transcription_job        t                 postgres  f     f              t             f
fail_voice_scoring            t                 postgres  f     f              t             f
```
Every one: `SECURITY DEFINER`, owned by `postgres`, executable **only**
by `service_role` — not `anon`, not `authenticated`, not even `PUBLIC`.
Confirms migration 42/45's later `revoke ... from public, anon,
authenticated` / `grant ... to service_role` correctly superseded
migration 41's initial broader grant, in the actually-deployed database,
not just in the source file.

Read the live function bodies (`claim_transcription_job`,
`claim_voice_scoring`, `complete_voice_scoring`, `fail_voice_scoring`)
and confirmed the misuse-prevention shape matches the migration source
exactly: `claim_*` only succeeds on a row that is `pending` or
past-stale-`processing`, generates a fresh random `lease_token` itself
(never caller-supplied), and returns it only to whichever caller's claim
actually matched a row (no double-claim race). `complete_*`/`fail_*`
require the *exact* `lease_token` the matching claim returned — an
unguessable UUID — so a caller cannot complete or fail a job/score it
did not itself just claim. None of the four check the caller's own
identity against `student_id` — deliberately not needed, since the
`EXECUTE` grant boundary already restricts every caller to `service_role`
alone, which is fully trusted server code.

**No privilege problem found.** No fix needed in staging.

**3. Targeted student test:** attempted again this step (a second
distinct attempt, not a retry of the same guess) is not applicable —
the same credential gap from Step 6M's attempt stands (the only
`prooflab-staging-student-password` secret available did not
authenticate as `t07`, `INVALID_LOGIN_CREDENTIALS`). Did not try a
different email/password combination — that would cross into guessing
credentials against a real account, which is not acceptable regardless
of how the goal is phrased. **Remains NOT TESTED**, same as Step 6M,
backed by the same indirect evidence (migration 42 confirmed live above)
plus the new direct evidence in part 1 of this section — staging's
`authenticated`/`anon` genuinely lack the grant today, confirmed by
direct catalog query rather than only by migration history this time.

**4. Manual production execution plan for migration 47 (not executed):**

**Correction (Step 6O) — the expected post-migration ACL below was wrong.**
The version of this section written in Step 6N said the post-migration
ACL should contain exactly `postgres` and `service_role`. That is
**staging's** baseline (staging's owner is `postgres`), not production's.
Production's actual pre-migration ACL, from the real Step 6M inspection,
is four roles: `prooflab_app`, `anon`, `authenticated`, `service_role` —
no `postgres` row at all. Migration 47 removes only `anon` and
`authenticated`. The corrected expectation is **`prooflab_app` and
`service_role` remaining** — not `postgres`/`service_role`. Production
and staging are not assumed to share an owner or grant list anywhere in
what follows.

Pre-check — capture the full ACL *before* the change, not just a
boolean, so a real before/after diff is possible (also explicitly checks
for a `PUBLIC` row and lets `has_table_privilege` account for any
inherited/role-membership grant on `authenticated`/`anon`, not only a
direct one):
```sql
select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee, a.privilege_type
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
 where c.relname = 'voice_explanations' and c.relnamespace = 'public'::regnamespace
   and a.privilege_type = 'UPDATE';
-- expect this pre-check to list: prooflab_app, anon, authenticated, service_role (no PUBLIC row)

select has_table_privilege('authenticated', 'public.voice_explanations', 'UPDATE') as auth_update,
       has_table_privilege('anon', 'public.voice_explanations', 'UPDATE') as anon_update,
       has_table_privilege('prooflab_app', 'public.voice_explanations', 'UPDATE') as app_update,
       has_table_privilege('service_role', 'public.voice_explanations', 'UPDATE') as svc_update;
-- expect: t, t, t, t (all four currently TRUE)

-- Alternative, if the connecting IAM account lacks USAGE on schema
-- "public" (regclass name resolution, above, needs that permission):
-- find the OID via pg_catalog directly, which is world-readable, then
-- pass the OID form of has_table_privilege instead of a table name.
select has_table_privilege('authenticated', c.oid, 'UPDATE') as auth_update,
       has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
       has_table_privilege('prooflab_app', c.oid, 'UPDATE') as app_update,
       has_table_privilege('service_role', c.oid, 'UPDATE') as svc_update
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'voice_explanations';
```

Apply (see access determination below — **not yet known to be
executable by any credential this session has**):
```sql
begin;
revoke update on public.voice_explanations from authenticated, anon;
commit;
notify pgrst, 'reload schema';
```

Verify — compare directly against the pre-check capture above. Expect
`authenticated`/`anon` gone from the ACL and `false` from
`has_table_privilege`; expect `prooflab_app`/`service_role` unchanged in
both the ACL listing and `has_table_privilege`:
```sql
select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee, a.privilege_type
  from pg_class c
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
 where c.relname = 'voice_explanations' and c.relnamespace = 'public'::regnamespace
   and a.privilege_type = 'UPDATE';
-- expect exactly: prooflab_app, service_role

select has_table_privilege('authenticated', 'public.voice_explanations', 'UPDATE') as auth_update,
       has_table_privilege('anon', 'public.voice_explanations', 'UPDATE') as anon_update,
       has_table_privilege('prooflab_app', 'public.voice_explanations', 'UPDATE') as app_update,
       has_table_privilege('service_role', 'public.voice_explanations', 'UPDATE') as svc_update;
-- expect: f, f, t, t
```

**Rollback is not automatic and not routine.** Re-granting `UPDATE` to
`authenticated`/`anon` recreates the exact standing risk this migration
removes — it is a separate, security-sensitive production change in its
own right, not a no-op undo. If migration 47 is ever found to have broken
something, the correct first response is to diagnose *why* a legitimate
path needed that grant (Step 6N's code/function audit found none — a
break would mean that audit missed something, which itself needs
understanding before reversing). Only re-grant with the same kind of
explicit, separate approval this migration itself required:
```sql
-- SECURITY-SENSITIVE — requires its own explicit approval, same as migration 47 did.
-- Do not run this as a default/automatic rollback step.
grant update on public.voice_explanations to authenticated, anon;
notify pgrst, 'reload schema';
```

**Fresh backup-status check, immediately before running the change**
(read-only, must be re-checked at execution time — the 2026-09-25 backup
cited in Step 6N will be stale by the time this actually runs):
```
gcloud sql backups list --instance=prooflab-db --project=prooflab-508214 --limit=1
```
Confirm a recent `SUCCESSFUL` backup exists right before applying —
this is a required check at execution time, not something satisfied by
an earlier session's read.

**Migrations 41–46 stay entirely separate**, with their own approvals for
Cloud Tasks/IAM/worker infrastructure, `WEBHOOK_SECRET` rotation, cost
limits (§10a), and the Firebase preview-channel canary (§9/§11) —
migration 47 does not imply or require approving any of that.

**5. Execution access — table owner and required authority (Step 6P
correction):**

**The table owner is UNKNOWN.** Step 6O's draft of this section guessed
`prooflab_app` from its presence in the ACL — that was a guess, not
evidence, and is withdrawn. ACL membership does not establish ownership;
Postgres does not require or imply that an owner appears in its own
table's ACL at all. The owner has never been directly queried. This
read-only query resolves it exactly, with no guessing, whenever an
authorized operator can run it:
```sql
select pg_get_userbyid(c.relowner) as table_owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'voice_explanations';
```

**`postgres` is not a Postgres superuser here, and that was also stated
too strongly before.** Cloud SQL's `postgres` account carries the
`cloudsqlsuperuser` role — a Cloud-SQL-specific bundle of administrative
privileges (`CREATEROLE`, `CREATEDB`, and similar), not the actual
Postgres `rolsuper` attribute, which Cloud SQL does not grant to anyone.
`cloudsqlsuperuser` does **not** automatically confer `REVOKE` authority
over every table in the database the way real `SUPERUSER` would — that
has to be checked, not assumed. The read-only way to check, once the
owner above is known, is whether `postgres` either *is* that owner or
holds `GRANT OPTION` on this specific `UPDATE` privilege:
```sql
select grantee, privilege_type, is_grantable
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'voice_explanations'
   and grantee = 'postgres';
-- if this returns no UPDATE row with is_grantable = 'YES', postgres
-- cannot REVOKE this privilege purely from being cloudsqlsuperuser
```

**Execution: BLOCKED**, and the exact requirement is now honestly
"unknown until the two queries above are run" rather than a specific
named role. No session held by or created for this engagement has ever
had `REVOKE` authority on this table — the Step 6M temporary IAM login
was deliberately read-only by design and is already deleted. Do not
create another login or change any permission to resolve this. Applying
migration 47 needs a human with an already-existing production
credential who is confirmed (by the two queries above, not assumed) to
either be the table's owner or hold `GRANT OPTION` on this `UPDATE`
privilege — most simply, the account that originally ran whatever
bootstrap script granted `authenticated`/`anon` this privilege in the
first place, since the grantor always retains authority to revoke what
it granted.

## 0. Corrections to the Step 6G draft of this checklist

- **Step 6M re-verification (no changes found):** re-checked migration
  order 41–46, migration 01 exclusion, backup-before-migration, Cloud
  Tasks concurrency limit, Cloud Run max-instances/budget alert gap
  (§10a), `PGRST_JWT_SECRET`/`WEBHOOK_SECRET` separation, the
  separately-approved rotation gate (§3), the Firebase preview-channel
  canary (§9/§11), and rollback limits (§12) against the current file.
  All still correct as of commit `8ba9aaa`; no drift, nothing to
  change. Part 2 (production `voice_explanations` grant check) remains
  **BLOCKED** pending a DBA running the read-only queries below against
  production and pasting results back — no new production access has
  become available this session.

- **Backup precedes migrations, not the other way round.** Step 6G's draft
  listed "database backup and migration preflight" as its own late item.
  It must run *before* step 2 below, not after it.
- **Webhook-secret rotation precedes scheduler creation, not the reverse.**
  The scheduler's header carries the secret's value at creation time; if
  the secret is rotated afterward the scheduler keeps invoking with the
  now-invalid old value until someone re-runs the equivalent of
  `scripts/staging-transcription-reap-scheduler.sh` for production. Rotate
  first (step 3 below), create the scheduler after (step 8).
- **Migration 40 is not a dependency of 41–46.** It touches
  `notifications`/`notify_weekly_progress` only — nothing in 41–46
  references that table or function. Its numerical position is
  coincidental, not a dependency signal. It can ship on its own schedule;
  it is listed here only because Step 6G's draft wrongly implied it
  blocked this rollout, and that needed correcting on the record, not
  because this rollout needs it.
- **Production transcriber capacity is not "load-tested."** Its current
  config (2 CPU, 2Gi memory, maxScale 3, concurrency 1) happens to match
  staging's. That is a coincidence of both having been sized the same way
  originally, not evidence it has been exercised under the load this
  feature will add. Capacity planning (step 10) must treat it as
  unvalidated until the canary (step 11) actually produces data.
- **`PGRST_JWT_SECRET` is not `WEBHOOK_SECRET`.** Step 6H's draft of step 6
  (worker deployment) said the worker's `PGRST_JWT_SECRET` should come
  from "the freshly rotated, step 3 production secret" — step 3 rotates
  `webhook-secret` only. That sentence would have pointed the worker's
  database-authentication secret at the wrong Secret Manager entry
  entirely. Corrected in step 6 below: the worker's `PGRST_JWT_SECRET`
  is `prooflab-jwt-secret`, a completely different secret that this
  rollout does not rotate and step 3 never touches. Rotating
  `webhook-secret` must never change what the worker signs its own
  PostgREST tokens with.
- **Migration 01 (the staging compat layer) must never run against
  production.** It bootstraps `auth`/`anon`/`authenticated`/`service_role`
  and a permissive baseline `GRANT ALL` from nothing, for a database
  rebuilt from a schema-only dump with `auth` excluded — that is staging's
  situation, not production's. Production has served real traffic under
  this same role/JWT model the whole time migration 41 assumes, which
  means the roles and baseline grants migration 01 creates from scratch
  already exist there, from whatever originally stood the database up.
  Migration 41's actual dependency is "these roles and functions already
  work," verified below, not "migration 01 has run" — it has not, and
  should not.
- **Actual production roles/grants were not fully verifiable read-only.**
  Confirmed via ordinary read traffic (real GETs, which production already
  serves) that `anon`/`authenticated`/`service_role` function as expected
  for reads. What could **not** be safely confirmed without risking an
  actual write is whether `authenticated` currently holds an overly broad
  table-level `UPDATE` on `voice_explanations` in production — the exact
  baseline-grant shape that made migration 43's column-level revoke
  ineffective in staging (Step 6C) and had to be fixed with a table-level
  one instead. This determines whether migration 42's revoke will actually
  take effect in production or needs the same table-level correction.

  **Step 6J: still BLOCKED.** No existing authorized read-only `psql`
  session against production exists in this environment — only a
  staging-scoped one (the Cloud Run job used throughout this engagement
  is bound to `prooflab-staging-db` and was not repointed at production,
  since creating or repointing any job against production infrastructure
  is itself a production change this step must not make). A human with
  real production DB access must run the queries below **before step 2**
  of this runbook. Read-only, catalog/privilege functions only — none of
  these write anything:

  ```sql
  -- table-level UPDATE on authenticated (the specific question):
  select has_table_privilege('authenticated', 'public.voice_explanations', 'UPDATE');

  -- every grant on the table, by role, so a "yes" above can be understood:
  select grantee, privilege_type
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'voice_explanations'
   order by grantee, privilege_type;

  -- column-level grants specifically, in case UPDATE was scoped narrowly
  -- rather than at the table level (the shape that would make it SAFE):
  select grantee, column_name, privilege_type
    from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'voice_explanations'
     and privilege_type = 'UPDATE'
   order by grantee, column_name;

  -- confirms the roles/functions this rollout's migrations assume exist
  -- (the actual dependency migration 41 has - see the correction above,
  -- not migration 01):
  select rolname from pg_roles
   where rolname in ('anon', 'authenticated', 'service_role');
  ```

  **Step 6M: UNBLOCKED and confirmed.** Project owner ran these via Cloud SQL
  Studio, connected with a temporary Cloud SQL IAM database user created
  and deleted the same session (no password, no role membership granted,
  no lingering access). Results:

  - `has_table_privilege('authenticated', ...)` = **TRUE**.
  - Table-level `UPDATE` grant on `public.voice_explanations` is held by
    four roles: `prooflab_app`, `anon`, `authenticated`, `service_role`.
  - No separate column-level `UPDATE` grant exists — this is the same
    "table-level, not column-level" shape migration 42 already fixed in
    staging (Step 6C), confirmed to exist in production too.
  - RLS is **enabled**, **not forced**. Existing policies:
    `voice_own_insert` (INSERT), `voice_own_read` (SELECT),
    `voice_own_delete` (DELETE) — **no UPDATE policy exists**.

  **Interpretation (per the explicit instruction not to call a raw grant a
  vulnerability by itself):** because RLS is enabled and no policy matches
  the `UPDATE` command for `authenticated`/`anon`, PostgREST's own
  default-deny for an unmatched command likely already blocks real
  exploitation today, independent of the table grant. Confirmed by code
  inspection (Step 6M) that no legitimate path needs this grant either:
  every server-side function's `createClient()` (`_shared/backend.ts`)
  always mints a `service_role` token on this backend regardless of which
  key is passed in, and grepping the frontend found only `.select()`,
  `.insert()` (a student's own new recording) and `.delete()`
  (`StudentPrivacy.tsx`'s delete-my-recording flow) against this table —
  never `.update()`. Migration 42's own comment already said the same
  thing about staging: "every real UPDATE of this table already runs as
  service_role."

  **Correction prepared, not applied:** `migration/47-production-voice-explanations-update-revoke.sql`
  — the same table-level `revoke update ... from authenticated, anon`
  migration 42 already uses in staging, given its own unused migration
  number since it has no dependency on the async job/queue schema and can
  ship to production independently of the larger 41–46 rollout. Does not
  touch `service_role` or `prooflab_app` — both are used for real UPDATEs
  server-side and are never reachable directly by a student's browser.
  Not applied to production; requires separate explicit approval to run.

  (Superseded — this paragraph was Step 6J's speculative "if the query
  returns true" draft, written before production access existed. The
  query has since run for real; see the confirmed findings and prepared
  migration above. Left removed rather than kept as dead text.)

## 1. Migration dependency order (41 → 47)

Actual dependencies, verified by reading each file, not assumed from
numbering:

| # | Adds | Depends on |
|---|---|---|
| 41 | `transcription_status` and friends on `voice_explanations`; `claim/complete/fail_transcription_job` | Working `anon`/`authenticated`/`service_role` roles and baseline grants already existing in production (not migration 01 — see §0) |
| 42 | Lease-token columns/fencing on the 41 functions; table-level `UPDATE` revoke | 41 (alters its columns and functions) |
| 43 | `claim_transcription_recovery`; `guard_voice_explanations_insert` trigger | 41, 42 (reads/writes 42's columns; the trigger forces values in columns 41/42 added) |
| 44 | `scoring_claimed_at`; `claim_voice_scoring` (timestamp-only) | None of 41–43 — independent column/function on the same table |
| 45 | `scoring_lease_token`; rewrites `claim/complete/fail_voice_scoring` with fencing | 44 (replaces its function, extends its column) |
| 46 | `recruiter_talent`/`recruiter_proof_profile` provenance filter | Reads `transcript_source`, which predates all of 41–45 (stage6) — otherwise independent of 41–45, but ships with them since it closes the gap they collectively created |
| 47 | Table-level `revoke update ... from authenticated, anon` on `voice_explanations` (Step 6M) | None of 41–46 — only touches grants on columns/roles that already exist in production today. Order-independent: safe to ship before, with, or after 41–46. If applied first and 41–46 follow later, migration 42's identical `revoke` statement becomes a documented Postgres no-op (revoking a privilege already absent succeeds silently, no error) |

All six are additive (new columns, new/replaced functions) — none drops or
renames anything an existing production code path reads. `prooflab-functions`
at v37 does not call any of them today, so applying all six in one window,
in this order, is safe with the feature flag left off.

## 2. Pre-migration backup

1. Confirm the most recent automated Cloud SQL backup for `prooflab-db`
   completed successfully (`gcloud sql backups list --instance=prooflab-db`).
2. Take one **on-demand** backup immediately before this window, named so
   it's identifiable (`gcloud sql backups create --instance=prooflab-db
   --description="pre-step6-migrations"`).
3. Confirm point-in-time recovery is enabled on the instance (it should
   already be, for `db-g1-small`) so a mid-window failure can roll back to
   seconds before the first migration, not just to last night's snapshot.

## 3. Webhook secret rotation (separate, explicitly approved change)

**Not part of this rollout's own approval — needs its own sign-off before
step 8.** Affected consumers, all of which must move together:

- Cloud Run services: `prooflab-functions`, `prooflab-accounts`
  (`secretKeyRef` → `webhook-secret`).
- Cloud Scheduler jobs, each carrying the secret in its own header config:
  `nightly-squads`, `extend-fixtures`, `daily-lots`, `weekly-seasons`,
  `weekly-progress`, `weekly-plan`, `prune-events`.

Rotation procedure: same shape as the staging rotation in Step 6D, but
generate the new value via the Secret Manager REST API directly (not
`gcloud secrets versions add --data-file=-` on Windows — that path silently
appended a trailing CR to the staging secret and made it unusable as an
HTTP header; see Step 6D's commit `9ad3489`). Force a new revision on both
services, update all seven scheduler jobs' headers, verify the old version
is disabled and the new one authenticates, before proceeding.

## 4. Service accounts and IAM (new, minimum)

Production currently has no dedicated service account for transcription —
`prooflab-functions` and `prooflab-transcriber` both run on the default
compute service account. Create, resource-scoped only (never a project-level
role):

- `prooflab-transc-wk@prooflab-508214.iam.gserviceaccount.com` — the worker.
  Grants: `roles/storage.objectViewer` on `prooflab-private-508214` only;
  `roles/secretmanager.secretAccessor` on `prooflab-jwt-secret` only.
- A dedicated invoker SA for Cloud Tasks → worker OIDC auth, mirroring
  `prooflab-staging-tasks-invoker`. Grant it `roles/run.invoker` on the
  worker service only.

Do not add either to `prooflab-functions`' or `prooflab-transcriber`'s
existing (default) service account — the worker's identity should be
narrower than what those two already run as, not layered onto them.

## 5. Cloud Tasks queue

Create `prooflab-transcription` in `asia-south1`, same starting config as
staging (`prooflab-staging-transcription`): `maxConcurrentDispatches: 2`,
`maxDispatchesPerSecond: 1`, `maxAttempts: 3`, backoff 5s–30s. Do not widen
these before the canary (step 11) shows headroom — they exist to protect
the transcriber's un-load-tested capacity (see the correction in §0).

## 6. Worker deployment

Deploy the same image already built and proven in staging
(`prooflab-transcription-worker`) to a new production service, env vars
pointed at production's own `POSTGREST_URL`/`TRANSCRIBER_URL`/
`PRIVATE_BUCKET=prooflab-private-508214`, `STALE_AFTER_SECONDS=180`,
`QUEUE_MAX_ATTEMPTS=3`. `PGRST_JWT_SECRET` is `prooflab-jwt-secret` — the
existing database-signing secret every other production service already
uses, untouched by and unrelated to step 3's `webhook-secret` rotation
(see §0). Do not point this at anything step 3 rotates.
`--no-allow-unauthenticated`, the step 4 SA.

## 7. functions-service deployment

Deploy the next `prooflab-functions` revision (current source already has
`transcription-enqueue`/`transcription-reap` registered in `SLUGS`) —
this alone does not expose anything new to students, since the frontend
flag (step 9) stays off. Confirm `/ready` reports all functions loaded
before proceeding.

## 8. Recovery scheduler

Only after step 3's rotation is complete. Create
`prooflab-transcription-reap` in Cloud Scheduler, same script pattern as
`scripts/staging-transcription-reap-scheduler.sh` (adapt the project's
non-staging URLs and queue name), reading the **rotated** secret at
creation time. Verify one real execution succeeds before moving on.

## 9. Feature flag

`VITE_ASYNC_TRANSCRIPTION` is a **build-time** Vite env var — confirmed
empirically across Steps 6E/6G by grepping built output: with it set, the
async code path's strings (`transcription-enqueue`, the "Uploading your
recording…" UI text) are compiled into the bundle; with it unset, they are
not. One build has exactly one value, for every visitor of whatever URL
serves that build. **A single real production account cannot be switched
to the async path by itself while sharing the main production URL with
everyone else** — there is no per-account runtime check anywhere in the
current code, only this one build-time constant. Do not attempt a
"canary" by editing `.env.production` and redeploying the main site: that
flips the flag for every current production user simultaneously, which is
exactly what a canary is meant to avoid.

Production's frontend deploys via Firebase Hosting (`scripts/deploy-hosting.py`,
site `prooflab-508214`). Firebase Hosting's own **preview channels**
(`firebase hosting:channel:deploy <channel-id>`) publish to a separate,
temporary URL without touching the live site's traffic at all — this is
the real isolated-canary mechanism, available today with no code change:

1. Build once with `VITE_ASYNC_TRANSCRIPTION=true` and every other
   `.env.production` value unchanged (real production backend URLs — a
   canary tests the real pipeline, not staging's).
2. Deploy that build to a preview channel, not the live site.
3. Give the channel's own URL to the one real account (or small cohort)
   running the canary. Everyone else continues using the unchanged main
   production URL/build, still flag-off.
4. Retire the channel (`firebase hosting:channel:delete`) once the canary
   concludes, whether it succeeds or is abandoned.

This isolates by URL, not by account identity — the canary participant
must actually be given and use the channel URL rather than the normal one.
That is a real, if manual, isolation boundary; a proper per-account runtime
flag (a column checked at app load, replacing or supplementing the
build-time constant) would be the scalable version of this, and is a
Step 7-sized change, not part of this rollout.

## 10. Monitoring and alerts

Before the canary:

- Alert on Cloud Tasks dead-letter/permanently-failed task rate > 0 over
  any 15-minute window.
- Alert on the worker's 5xx rate.
- Alert on `reap_stale_transcription_jobs`/`claim_transcription_recovery`
  recovery volume exceeding a small absolute threshold (e.g. > 5/hour) —
  a rising rate means something is genuinely stuck, not just a slow
  DeepSeek call.
- Dashboard: queue depth, worker request latency p50/p95, transcriber
  request latency p50/p95 (this is the number that tells you whether the
  "matches staging" capacity assumption in §0 was actually fine).

### 10a. Cost limits (added Step 6L — not yet configured, documentation only)

No cost/capacity cap exists today for this pipeline in either environment
(confirmed by inspection — no Cloud Tasks queue rate limit, no Cloud Run
max-instance cap tied to transcription specifically, no GCP budget alert
scoped to this feature). Before the canary, set:

- Cloud Tasks queue `maxDispatchesPerSecond` / `maxConcurrentDispatches` on
  the production transcription queue, sized from staging's observed load.
- A Cloud Run max-instances limit on `transcription-worker` and
  `prooflab-transcriber`, so a stuck-retry storm cannot scale unboundedly.
- A GCP budget alert (or reuse of an existing project-wide one) that
  includes the transcriber's Whisper/DeepSeek call volume, since that is
  the highest per-request cost in this path.

These are config values applied at deploy time (step 5/6/7), not code
changes — flagged here as a gap this runbook did not previously call out
explicitly, per Step 6L's review request. Setting them is part of the
production rollout itself and therefore still requires the same approval
as any other production change in this runbook.

## 11. Canary

Using step 9's preview-channel build, run the canary for at least one
full day with the one real low-stakes account (or the smallest real
cohort the product owner accepts) actually using that channel's URL.
Watch every metric in step 10. Do not widen the cohort — by adding more
people to the same channel, then eventually flipping the flag on the main
site — until a full day has produced zero unexplained stuck jobs and zero
worker error-rate spikes.

## 12. Rollback limits

- **Frontend flag**: instantly reversible — turn `VITE_ASYNC_TRANSCRIPTION`
  back off and redeploy. Always the first rollback action.
- **Migrations 41–46**: additive only, safe to leave applied even with the
  flag off — nothing in the existing (flag-off) code path reads any column
  or function they add.
- **Not safely reversible once jobs are in flight**: deleting the Cloud
  Tasks queue, or dropping/altering any of the new columns, while real
  jobs have been accepted. If a rollback beyond the flag is ever needed:
  disable the flag first, let the queue drain (confirm depth reaches
  zero), *then* consider any further reversal — never the reverse order.
- **Webhook secret rotation (step 3)**: reversible in principle (re-enable
  the old Secret Manager version) but not something to reverse casually —
  treat it as a one-way step once the seven scheduler jobs are confirmed
  working on the new value.

## Appendix: read-only production facts this runbook is based on (Step 6G/6H)

- `voice_explanations` in production has none of migrations 41–46's columns.
- No production Cloud Tasks queues exist.
- `prooflab-functions` and `prooflab-transcriber` run on the default
  compute service account, not a dedicated one.
- `prooflab-functions` is at `v37` (38 functions loaded; does not include
  `transcription-enqueue`/`transcription-reap`).
- Migration 40 (`notifications.dedupe_key`) is also not yet applied —
  independent of this rollout (see §0).
- Production frontend deploys via Firebase Hosting (`scripts/deploy-hosting.py`,
  site `prooflab-508214`), not a Cloud Run service — relevant to how the
  canary in §9/§11 is actually isolated.
- Whether `authenticated` holds table-level `UPDATE` on production's
  `voice_explanations` was **not** determined this session — it needs a
  real `psql` session, not a read-only REST probe (see §0). This is the
  one open fact-finding item before step 2.

## Appendix: verified-recruiter test — closed in Step 6K

Step 6J found the `recruiters` table empty and left this plan unexecuted
pending approval. **Approved and executed in Step 6K.** One new staging
Identity Platform account was created (real `accounts:signUp`, real
sign-in through the staging auth-bridge to resolve its uuid), one
`recruiters` row was inserted for that uuid with `verified = true`, and
the real recruiter session (the actual bridge-issued token, not a
hand-minted one) called the real `recruiter_talent` and
`recruiter_proof_profile` RPCs against a fixture with one server-verified
explanation (score 80) and one browser-authored explanation (score 99,
deliberately higher, on the same proof).

Result: the browser-authored row (99) did not appear anywhere in
`recruiter_proof_profile`'s `explanations` list, and both `communication`
and `recruiter_talent`'s `comms_score` came back as `43` — **not** 80,
and not 89.5 (a naive average of 80 and 99). 43 is the average of every
`transcript_source = 'server'` scored explanation this test student
already had (this account has been reused across Steps 6E–6K, so several
older eligible rows - 55, 25, 20, 45 and others not shown in the
`explanations` list's top-5 - already existed before this fixture's 80
was added). The correct, precise claim is: **the 99 contributed nothing
to either number, and every number that appeared was built only from
`'server'`-sourced rows** - not that the average should have equaled 80
alone. (An earlier draft of this note stated the result as "both
reflected only the server-verified 80," which reads as claiming the
average *equalled* 80; it did not - corrected here in Step 6L.)
`recruiter_talent` also confirmed the target student was discoverable at
all (`total_matches: 1`), proving the search path, not just the
profile-detail path.

Fixture cleaned up afterward: the test task/proof/both voice rows deleted,
the `recruiters` row's `verified` flag set back to `false` (row kept, not
deleted, for reproducibility - matches how `t07`/`t16` are kept as
standing staging fixtures rather than torn down after each use). The
Identity Platform login itself was left in place, inert, same treatment.
