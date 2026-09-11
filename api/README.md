# api/ — the piece Supabase supplied and Google does not

Supabase includes PostgREST: the browser calls `supabase.from('x').select()`,
PostgREST turns that into SQL, and the 145 RLS policies decide which rows come
back. Google Cloud has no equivalent, so this service is that missing middle.

## The rule this service obeys

**It never decides what a caller may see. It only states who the caller is.**

```
request -> verify token -> SET LOCAL request.jwt.claims -> query -> RLS filters
```

`auth.uid()` reads that setting and the policies read `auth.uid()`, so the same
145 policies that protect the Supabase database protect this one, unchanged and
already tested (see the Phase 2 notes in HANDOFF-SECURITY-2026-09-11.md).

A bug in this code can mislabel a caller. It cannot grant access the policies do
not already allow - which is deliberate, because policy logic is where the three
holes found on 2026-09-10 actually lived.

## Files

| file | what |
|---|---|
| `db.ts` | identity into the database. The security-critical file. |
| `auth.ts` | bearer token into claims. Swappable in Phase 4. |
| `main.ts` | the HTTP server and the routes. |
| `api_test.ts` | isolation tests: does each caller get only their own rows. |

## The one detail that matters most

`db.ts` uses **`SET LOCAL`**, never `SET`.

`LOCAL` scopes the setting to the transaction, so the caller's identity is gone
the instant it commits. With a connection pool, a plain `SET` would leave that
identity on the pooled connection and the next request to borrow it would
inherit the previous caller's identity - one user silently served another user's
data. `api_test.ts` has a test for exactly this ("a different student sees a
DIFFERENT single row"); it fails if the word is ever dropped.

## Refusal vs emptiness

These are different answers and the service keeps them apart:

| situation | reply |
|---|---|
| role has no grant on the table (SQLSTATE 42501) | `401` / `403` - "you may not look" |
| role has a grant, policies match no rows | `200 []` - "you may look, nothing here for you" |

Returning `[]` for a refusal would assert the table is empty, which is false,
and would hide a broken permission from anyone reading the logs.

## Running it

Needs the Cloud SQL Auth Proxy on 5433 (no public address is open on the
instance, by design):

```
cloud-sql-proxy --port 5433 prooflab-508214:asia-south1:prooflab-db

export PGPASSWORD="$(gcloud secrets versions access latest --secret=prooflab-db-password)"
export API_JWT_SECRET=...            # HS256 for now; Identity Platform in Phase 4
deno run --allow-net --allow-env api/main.ts
```

Tests:

```
deno test --allow-net --allow-env api/api_test.ts
```

## Status

1 of 123 endpoints (60 tables + 63 RPCs). The endpoint was never the hard part;
the pattern was. The rest repeat it, and each is verified the same way - call it
as several people, check nobody receives a row that is not theirs.
