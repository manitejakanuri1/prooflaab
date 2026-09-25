-- 42: Step 6B - three real gaps found reviewing migration 41 before anything
-- in it touched a UI. Staging only, not applied to production.
--
-- (1) Enqueue-side ownership checks live in transcription-enqueue's own code,
--     not here - nothing to migrate for that, see the function's diff.
--
-- (2) claim/complete/fail_transcription_job were granted to `authenticated`
--     as well as `service_role`. SECURITY DEFINER means they already run as
--     their owner regardless of caller - granting EXECUTE to authenticated
--     let any signed-in student call them directly over PostgREST and force
--     any voice_explanations row into 'completed' with a fabricated
--     transcript. Also: the plain table-level GRANT ALL from
--     migration/01-compat-layer.sql's baseline-privileges section means
--     `authenticated` can UPDATE voice_explanations directly via PostgREST
--     with no RPC involved at all - and a column-level REVOKE cannot narrow
--     that, because Postgres's column privileges only restrict a column when
--     the TABLE-level privilege was never granted broadly in the first place;
--     once UPDATE is granted at the table level, per-column revokes on top of
--     it have no effect. Fixed with a table-level REVOKE UPDATE instead -
--     students never need to update this row directly, insert (the browser's
--     existing sync-path write) is untouched, and every real write already
--     goes through a SECURITY DEFINER function running as service_role
--     (voice-score, and now these three).
--
--     A second, easy-to-miss order-of-operations bug in the first version of
--     this migration: it revoked EXECUTE from these functions and only THEN
--     dropped and recreated them to add the lease-token parameter - but
--     CREATE FUNCTION resets a function's privileges to Postgres's own
--     default (EXECUTE granted to PUBLIC) regardless of what was revoked
--     before it existed. The revoke has to come AFTER the create, not before,
--     or it is silently undone. Caught by testing an actual authenticated
--     call against the deployed function, not by reading the SQL.
--
-- (3) A crashed worker's claim only outlives the whole retry window instead
--     of outliving one attempt: the queue's 3 attempts at 5-30s backoff
--     exhaust in well under a minute, but the old 180s stale-lease meant a
--     genuinely crashed worker's claim was never stale by the time Cloud
--     Tasks gave up and deleted the task - the job was stranded with no
--     lease left to reclaim it and no task left to trigger a reclaim. Fixed
--     with two changes: a lease token, so a late completion from an EXPIRED
--     claim can never overwrite a result a NEWER claim already saved; and a
--     reap function (called by transcription-reap, staging-only, see that
--     function) that finds stale rows and re-enqueues them itself, instead
--     of depending on Cloud Tasks' own short retry budget to rediscover a
--     crash.
begin;

alter table public.voice_explanations
  add column if not exists transcription_lease_token uuid;

-- ── (3) claim now issues a lease token; complete/fail must present it ───────
-- Recreate first, lock down privileges after (see the order-of-operations
-- note above) - a lease token, so a late completion from an EXPIRED claim
-- - an expired worker that was not really dead, just slow, finally reporting
-- back after a newer attempt already claimed and possibly finished the row -
-- matches no live lease and is correctly ignored.
drop function if exists public.claim_transcription_job(uuid, integer);
create or replace function public.claim_transcription_job(_id uuid, _stale_after_seconds integer default 180)
returns table (id uuid, student_id uuid, storage_path text, task_id uuid, attempts integer, lease_token uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare _lease uuid := gen_random_uuid();
begin
  return query
  update public.voice_explanations v
     set transcription_status = 'processing',
         transcription_claimed_at = now(),
         transcription_attempts = v.transcription_attempts + 1,
         transcription_lease_token = _lease
   where v.id = _id
     and (
       v.transcription_status = 'pending'
       or (v.transcription_status = 'processing'
           and v.transcription_claimed_at < now() - make_interval(secs => _stale_after_seconds))
     )
  returning v.id, v.student_id, v.storage_path, v.task_id, v.transcription_attempts, v.transcription_lease_token;
end $function$;

drop function if exists public.complete_transcription_job(uuid, text, jsonb, integer);
create or replace function public.complete_transcription_job(
  _id uuid, _lease_token uuid, _transcript text, _segments jsonb default null, _word_count integer default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  update public.voice_explanations
     set transcript = _transcript,
         transcript_segments = coalesce(_segments, transcript_segments),
         word_count = coalesce(_word_count, word_count),
         transcript_source = 'server',
         transcription_status = 'completed',
         transcription_error = null
   where id = _id and transcription_status = 'processing' and transcription_lease_token = _lease_token;
  get diagnostics n = row_count;
  return n > 0;
end $function$;

drop function if exists public.fail_transcription_job(uuid, text, boolean);
create or replace function public.fail_transcription_job(_id uuid, _lease_token uuid, _error text, _terminal boolean default true)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  update public.voice_explanations
     set transcription_status = case when _terminal then 'failed' else 'pending' end,
         transcription_error = left(_error, 500)
   where id = _id and transcription_status = 'processing' and transcription_lease_token = _lease_token;
  get diagnostics n = row_count;
  return n > 0;
end $function$;

-- Finds rows a worker claimed and then went silent on - past the same
-- staleness window claim_transcription_job itself uses - and releases them
-- back to 'pending' so a fresh enqueue can pick them up. Does not talk to
-- Cloud Tasks itself: transcription-reap (the function that calls this) does
-- the re-enqueueing, since only that service holds the enqueuer role.
create or replace function public.reap_stale_transcription_jobs(_stale_after_seconds integer default 180)
returns table (id uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  return query
  update public.voice_explanations v
     set transcription_status = 'pending',
         transcription_claimed_at = null,
         transcription_lease_token = null
   where v.transcription_status = 'processing'
     and v.transcription_claimed_at < now() - make_interval(secs => _stale_after_seconds)
  returning v.id;
end $function$;

-- ── (2) lock down privileges NOW, after every create/replace above ─────────
revoke all on function
  public.claim_transcription_job(uuid, integer),
  public.complete_transcription_job(uuid, uuid, text, jsonb, integer),
  public.fail_transcription_job(uuid, uuid, text, boolean),
  public.reap_stale_transcription_jobs(integer)
  from public, anon, authenticated;

grant execute on function
  public.claim_transcription_job(uuid, integer),
  public.complete_transcription_job(uuid, uuid, text, jsonb, integer),
  public.fail_transcription_job(uuid, uuid, text, boolean),
  public.reap_stale_transcription_jobs(integer)
  to service_role;

-- Table-level revoke, not column-level (see the note above on why
-- column-level cannot narrow an existing table-level grant). INSERT is
-- untouched - the browser's existing sync path still inserts its own row
-- directly as the student. Every real UPDATE of this table already runs as
-- service_role (voice-score, and now these three RPCs).
revoke update on public.voice_explanations from authenticated, anon;

commit;
notify pgrst, 'reload schema';
