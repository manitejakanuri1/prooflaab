# Handoff — security and performance pass, 10–11 Sep 2026

Written so the next session (or the other laptop) does not have to rediscover
any of this. Everything below is either pushed to `prooflaab/main` or applied to
the live database.

---

## ⚠️ THE ONE THING STILL NOT DONE

**The edge functions have never been deployed.** Every fix below that lives in a
function is in git and *not* on the live site.

```
supabase functions deploy
```

Until that runs, a signed-in student can still read any other student's private
proof files on the live site. The database half of the fix is live; the function
half is not.

---

## Security holes found and fixed

An audit of 44 edge functions, 88 tables and 184 RLS policies. No SQL injection,
no XSS, no RCE, no leaked secrets — all three findings were authorization
scoping.

### 1. Any college_admin could read every student on the platform — HIGH

Five functions checked the *role* and never the *college*:

```ts
if (roleNames.includes('admin') || roleNames.includes('college_admin')) {
  allowed = true;      // which college? never asked
}
```

They run with the service-role key, so RLS never sees the query. `proof-file-url`
was the worst: the proofs bucket is private and that function is the only way in,
so one dropdown choice at sign-up reached a signed URL for any student's private
upload, in any college.

Fixed by `_shared/authz.ts` → `mayActOnStudentWork()`, used by
`proof-file-url`, `moss-check`, `ai-authorship`, `github-check`,
`question-generator`.

### 2. Three functions checked who you were, not whose data — MEDIUM-HIGH

`verify-proof`, `trust-compute`, `response-evaluator` authenticated the caller,
discarded the identity, then acted on an id from the request body with the
service-role key. Any student could re-verify a stranger's proof, overwrite their
`trust_score`, and file `audit_logs` rows under the victim's user id.

Same helper. `trust-compute` and `response-evaluator` also accept a webhook
secret for cron — `callerId` stays null on that path so the scheduled jobs are
unaffected.

### 3. college_admin was powerful without approval — migrations 63/64

`colleges.verification_status` existed since stage 1 and was never enforced.
Stage 63 adds `my_approved_college_ids()` and points twelve policies at it.
Stage 64 does the same inside `my_college_id()`, which 29 functions and 15 more
policies use.

Also normalised the column: the one college row said `'verified'`, a value
nothing else used, and the CHECK constraint existed on `startups` but not
`colleges` — so `AdminDashboardOverview.tsx:37` had been counting zero active
colleges while one existed.

### 4. CORS wildcard on 38 functions

All had `Access-Control-Allow-Origin: '*'` while holding the service-role key.
Now one `_shared/cors.ts`, one origin, `ALLOWED_ORIGIN` to override.

**Local dev now needs `ALLOWED_ORIGIN=http://localhost:8080` set.**

`www` already 302-redirects to the apex, so one origin is sufficient — checked,
not assumed.

### 5. Twenty-six functions returned raw database errors to the caller

`JSON.stringify({ error: error.message })` hands Postgres messages — table names,
column names, constraint names — to anyone who can make a request fail. All
twenty-six now reply `'Internal server error'`; every `console.error` is intact.

Side effect: `deno check` errors fell 29 → 5. Most were TS18046 on those same
`error.message` accesses.

---

## Performance

- **Admin dashboard** used `count: 'exact'` without `head: true`, shipping every
  row of five tables to compute ten numbers. Now ten counting queries.
- **Student rank** fetched `get_leaderboard(1000)` to read one integer, and
  returned 0 for anyone past rank 1000. Now `my_rank()`.
  The live `get_leaderboard` is **college-scoped**; the migration file still
  shows a platform-wide body. stage65 was written against the file and was wrong;
  stage65b corrected it. Read the deployed function, not the folder.
- **21 foreign keys** had no covering index. Added.
- **Eight tables** ran duplicate SELECT policies. Merged, verified by comparing
  visible row counts for a student, a college admin and an admin before and
  after — identical on all eight.
- **Ten unbounded list queries** capped at `ADMIN_LIST_CAP` (`src/lib/listCaps.ts`).

### Not done, deliberately

- **Twenty unbounded queries remain.** They need real pagination and a UI
  decision about a next-page control.
- **21 "unused" indexes NOT dropped.** On a database with no traffic every index
  reads as unused; the statistics are meaningless. Only a genuine duplicate went.
- **Six policy sets NOT merged** (`announcements`, `learning_resources`,
  `proof_uploads`, `verification_settings`, `recruiters`, `user_roles`) — their
  second policy is FOR ALL, so merging means restructuring write access to buy a
  read speedup.

---

## Migrations applied to the live database

`apply_migration` stamps its own clock version, not the filename's. Files are
named for what the ledger recorded.

| Version | Name |
|---|---|
| 20260910165902 | stage63_college_admin_must_be_approved |
| 20260910170225 | stage64_college_helpers_require_approval |
| 20260910173334 | stage65_my_rank_without_fetching_the_leaderboard |
| 20260910173433 | stage65b_my_rank_matches_the_college_scoped_leaderboard |
| 20260910173521 | stage66_index_the_unindexed_foreign_keys |
| 20260910173544 | stage66b_drop_the_duplicate_leaderboard_index |
| 20260910173717 | stage67_merge_duplicate_select_policies |

The other laptop independently used `20261001000500_stage63_*` the same day.
Both applied, neither depends on the other.

---

## Infrastructure decisions

**Google Cloud VM: built, then deleted.** Instance, 50GB disk, static IP,
snapshot and schedule all removed — billing stopped. Firewall rules kept (free
and already correct). APIs left enabled (free).

**Why it was abandoned**, after checking rather than assuming:

- Cloud SQL **cannot** run Supabase. RDS/Cloud SQL lock down superuser and
  extension installation, which is exactly what the Supabase stack needs.
- Google Cloud Storage is **not** a documented Supabase Storage backend. Only
  `file` and S3-compatible are.

So the "Google guards your database, you keep Supabase" design does not exist.
The real choice is Supabase Cloud (managed) or self-host everything (you
maintain it).

**Current state: Supabase free plan, ₹0/month.** Moving to AWS or GCP means
rewriting Cognito/Identity Platform auth (184 RLS policies + 230 `auth.uid()`
call sites) and building a PostgREST replacement for 31 tables — weeks of work
to arrive at roughly the same monthly bill.

**AWS account created** (paid tier, so AWS Activate is available; Basic support,
free). Nothing deployed. Next: MFA on root, a zero-spend budget alarm, then apply
for Activate.

---

## Verification standard used

Nothing here was asserted without a check:

- RLS scaling proved with `EXPLAIN ANALYZE` — `my_approved_college_ids()` runs as
  a hashed SubPlan at `loops=1`, once per query, and all 12 filtered columns are
  indexed.
- Policy merge proved by before/after visible-row counts per persona.
- `my_rank()` proved by running it and `get_leaderboard()` in a real student's
  session — both returned 2.
- Type errors compared against the pre-change tree extracted to a temp
  directory, so "no new errors" means the lists were diffed, not eyeballed.

13 Deno tests, `tsc --noEmit`, and `vite build` all clean at the last push
(`ae2f9ac`).
