# Step 6 — backend proposals (NOT applied; each needs separate owner approval)

Written 2026-09-29 for the round-6 review. Nothing here has been run against any database.
No migration file was created: the SQL below is text in a document, for review only.
Evidence is from the repository, not from the live databases. The live function bodies and
`pg_constraint` were not read.

## N3 — the browser insert guard does not check that `storage_path` is the student's own

### What the repository shows
- `supabase/migrations/20260818010000_stage6_voice_and_streaks.sql:54-55`: policy
  `voice_own_insert ... with check (student_id = (select auth.uid()))`. It says nothing about the file path.
- `migration/43-transcription-durable-recovery.sql` `guard_voice_explanations_insert()`:
  - It checks `task_id` and `proof_id` ownership for non-service-role inserts, and forces safe values (status, score, and so on).
  - It does **not** check `storage_path`.
  - Migration 45 only asserts that this function exists; it does not redefine it.
- `supabase/functions/transcription-enqueue/index.ts:100-107` does require `storage_path` to start with `profile.id/` (the queued path is already protected).
- `files-service/main.ts` only lets the owner of the first folder download, so a foreign path still cannot be played.

### Effect today
A signed-in student can insert their own row (the synchronous path) whose `storage_path` names
another student's file. They cannot download that file. But the row then claims someone else's
audio as their own recording, which is misleading data and a weak point for future features that
read `storage_path`. No real misuse has been found. The one such staging row is the deliberate
`g1_access_test.py` fixture, created with the service role.

### Proposed change (text only)
In `guard_voice_explanations_insert()`, after the `service_role` early return and before the task/proof checks:

```sql
  -- The file must be inside the student's own folder: "<student_id>/<one file name>".
  -- The name starts with a letter or digit; dots only separate extensions.
  if new.storage_path is null
     or new.storage_path !~ ('^' || new.student_id::text || '/[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9]+)*$')
  then
    raise exception 'storage_path must be inside your own folder';
  end if;
```

- **Correction (round 7):** the round-6 version used `'/[A-Za-z0-9._-]+$'`. That pattern **accepted** `<id>/..`, `<id>/.`, `<id>/.hidden` and `<id>/a..b.webm`, so the earlier claim that it refused `..` was wrong. The corrected pattern above was checked against 16 cases (Python's regex engine, which behaves the same way for this pattern). It accepts the three real path shapes: `<uuid>-explain.webm`, `<ms>-explain.webm` and `.m4a`. It refuses `..`, `.`, `.hidden`, `a..b.webm`, `../x.webm`, `//x.webm`, `sub/x.webm`, `<id>`, `<id>/`, another student's folder, a trailing `/`, a space, and `%2e`. The Postgres self-check below is what proves it inside the database.
- **Strict shape:** exactly one folder level. The file name is one or more `A-Z a-z 0-9 _ -` characters starting with a letter or digit, optionally followed by `.ext` parts.
- **Compatibility:** every current browser path is `<student>/<uuid>-explain.webm|m4a` (round 4+) or `<student>/<ms>-explain.<ext>` (older), and both match. The service role is unchanged, so the worker, transcription-enqueue and the test fixtures keep working.
- Apply the same rule to UPDATE if an UPDATE policy is ever added. Today none exists (`migration/47-...-update-revoke.sql`).
- Existing rows are not changed.
- Rollout: the usual process. Write `migration/NN-*.sql` with a `do $$` self-check that runs the four refusal cases below inside a savepoint. Rehearse on staging. Then production with the owner's yes.

### Required tests (real database, a separately approved staging run)
Each case is a separate attempt; nothing is committed on refusal.
1. Student A inserts with `storage_path = '<A>/<uuid>-explain.webm'`: accepted (the current app keeps working).
2. Student A inserts with `storage_path = '<B>/<uuid>-explain.webm'`: refused with "storage_path must be inside your own folder".
3. Student A inserts with `'<A>/..'`, `'<A>/.'`, `'<A>/.hidden'`, `'<A>/a..b.webm'`, `'<A>/../<B>/x.webm'`, `'<A>//x.webm'`, `'<A>/sub/x.webm'`, `'<A>'`, `'<A>/'`, an empty string or NULL: each refused.
4. The service role inserts a row for A with any path: accepted (the worker and fixtures are unaffected).
5. The browser synchronous save (real signed-in session, `VITE_ASYNC_TRANSCRIPTION` unset) still saves end to end.
6. The self-check block proves cases 2 and 3 raise, inside a savepoint that is rolled back.

## Other proposals carried forward (unchanged; see earlier rounds)
1. A per-bucket size limit for `voice-explanations` (files-service `MAX_BYTES` is 10 MB for every bucket), and a real audio-duration check in transcription-worker, which refuses anything over 62 s.
2. `transcription-enqueue` verifies that the object exists before inserting a job.
3. A files-service `HEAD` route (owner check, no body) for existence checks. The browser currently downloads up to about 1 MB to check.
4. A report, then a clean-up, of uploaded objects that never got a row (orphans from closed tabs or removed records).
5. Prove idempotency under real parallel calls:
   - two simultaneous `transcription-enqueue` calls with one key must give one row;
   - two simultaneous `upsert:false` uploads to one path must store one file. files-service does `stat` then `writeFile`, which is not atomic, so it needs an exclusive create (`wx`) or a generation precondition.
6. Real-session integration tests:
   - an account switch between the browser's account check and the request's token fetch (the adapters fetch the token asynchronously);
   - token refresh;
   - RLS for all of the above.
