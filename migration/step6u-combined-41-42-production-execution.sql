-- Step 6U: combined, atomic production execution of migrations 41 and 42.
--
-- WHY COMBINED: applying migration 41 alone leaves an intermediate state
-- with a real, exploitable exposure. Migration 41 grants EXECUTE on
-- claim/complete/fail_transcription_job to `authenticated`, and NEVER
-- revokes the EXECUTE Postgres grants to PUBLIC by default on every
-- CREATE FUNCTION. Neither function checks caller identity against
-- student_id, and neither has a lease token yet (added only in 42). So
-- after 41 alone, any connected role - via the PUBLIC grant alone, not
-- even needing the explicit `authenticated` grant - could call
-- complete_transcription_job(_id, transcript) on ANY student's row and
-- force an arbitrary fabricated transcript into it, marked
-- transcript_source='server' as if worker-verified. Migration 42's own
-- header comment documents this exact class of bug. Wrapping both in one
-- transaction means Postgres's MVCC never makes the intermediate state
-- visible to any other session - it either sees the pre-migration state
-- or the final, fully-locked-down state, never anything in between.
--
-- WHY FAIL-CLOSED CHECKS ARE INSIDE THE TRANSACTION, BEFORE COMMIT: a
-- check run AFTER commit cannot undo anything - once COMMIT succeeds the
-- change is durable. Cloud SQL Studio also opens a new session per
-- execution, so pre-checks, both migration bodies, and verification must
-- all be one paste, one transaction. If any check below fails, it
-- RAISEs, which aborts the whole transaction automatically - nothing
-- from 41 or 42 is left applied.
--
-- Every statement below is copied verbatim from migration/41-transcription-jobs.sql
-- and migration/42-transcription-jobs-hardening.sql, in their original
-- order, with only their own individual BEGIN/COMMIT/NOTIFY removed so
-- they share this one outer transaction. The original migration files
-- are NOT modified.

begin;

-- ============================================================
-- migration 41 body (unmodified statements)
-- ============================================================

alter table public.voice_explanations
  add column if not exists transcription_status text not null default 'completed'
    check (transcription_status in ('pending', 'processing', 'completed', 'failed')),
  add column if not exists transcription_claimed_at timestamptz,
  add column if not exists transcription_attempts integer not null default 0,
  add column if not exists transcription_error text,
  add column if not exists transcription_idempotency_key text unique;

create index if not exists voice_explanations_transcription_status_idx
  on public.voice_explanations (transcription_status)
  where transcription_status in ('pending', 'processing');

-- Added in Step 6U, not part of migration 41's original file: a staging
-- rehearsal of this exact combined script found that CREATE OR REPLACE
-- cannot change an existing function's return-column shape, and a
-- database already carrying migration 42's 6-column version of this
-- function (staging's actual live state) would fail here otherwise.
-- Production has neither version today, so this DROP is a no-op there -
-- added purely so this script is safely re-runnable against any
-- starting state, matching the same pattern 42 already uses for its own
-- recreation of this function.
drop function if exists public.claim_transcription_job(uuid, integer);
create or replace function public.claim_transcription_job(_id uuid, _stale_after_seconds integer default 180)
returns table (id uuid, student_id uuid, storage_path text, task_id uuid, attempts integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  return query
  update public.voice_explanations v
     set transcription_status = 'processing',
         transcription_claimed_at = now(),
         transcription_attempts = v.transcription_attempts + 1
   where v.id = _id
     and (
       v.transcription_status = 'pending'
       or (v.transcription_status = 'processing'
           and v.transcription_claimed_at < now() - make_interval(secs => _stale_after_seconds))
     )
  returning v.id, v.student_id, v.storage_path, v.task_id, v.transcription_attempts;
end $function$;

create or replace function public.complete_transcription_job(
  _id uuid, _transcript text, _segments jsonb default null, _word_count integer default null
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
   where id = _id and transcription_status = 'processing';
  get diagnostics n = row_count;
  return n > 0;
end $function$;

drop function if exists public.fail_transcription_job(uuid, text);

create or replace function public.fail_transcription_job(_id uuid, _error text, _terminal boolean default true)
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
   where id = _id and transcription_status = 'processing';
  get diagnostics n = row_count;
  return n > 0;
end $function$;

grant execute on function
  public.claim_transcription_job(uuid, integer),
  public.complete_transcription_job(uuid, text, jsonb, integer),
  public.fail_transcription_job(uuid, text, boolean)
  to authenticated, service_role;

-- ============================================================
-- migration 42 body (unmodified statements)
-- ============================================================

alter table public.voice_explanations
  add column if not exists transcription_lease_token uuid;

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

revoke update on public.voice_explanations from authenticated, anon;

-- ============================================================
-- fail-closed verification, INSIDE the transaction, BEFORE commit.
-- Any RAISE EXCEPTION here aborts the entire transaction - nothing
-- above is left applied.
-- ============================================================

do $$
declare
  v_count integer;
  v_grantee text;
  v_priv text;
  v_row record;
begin
  -- (a) all six transcription columns exist
  select count(*) into v_count from information_schema.columns
   where table_schema = 'public' and table_name = 'voice_explanations'
     and column_name in ('transcription_status', 'transcription_claimed_at',
       'transcription_attempts', 'transcription_error',
       'transcription_idempotency_key', 'transcription_lease_token');
  if v_count <> 6 then
    raise exception 'expected 6 transcription columns on voice_explanations, found %', v_count;
  end if;

  -- (b) no unsafe old-signature overload remains
  if exists (
    select 1 from pg_proc where pronamespace = 'public'::regnamespace
     and proname = 'complete_transcription_job'
     and pg_get_function_identity_arguments(oid) = 'uuid, text, jsonb, integer'
  ) then
    raise exception 'unsafe old 4-arg complete_transcription_job(uuid,text,jsonb,integer) overload still exists';
  end if;
  if exists (
    select 1 from pg_proc where pronamespace = 'public'::regnamespace
     and proname = 'fail_transcription_job'
     and pg_get_function_identity_arguments(oid) in ('uuid, text, boolean', 'uuid, text')
  ) then
    raise exception 'unsafe old fail_transcription_job overload still exists';
  end if;

  -- (c) exactly the four final functions exist, with the correct final
  -- signature, and are SECURITY DEFINER
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
      and proname = 'claim_transcription_job'
      and pg_get_function_identity_arguments(oid) = '_id uuid, _stale_after_seconds integer'
      and prosecdef) then
    raise exception 'claim_transcription_job missing, wrong signature, or not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
      and proname = 'complete_transcription_job'
      and pg_get_function_identity_arguments(oid) = '_id uuid, _lease_token uuid, _transcript text, _segments jsonb, _word_count integer'
      and prosecdef) then
    raise exception 'complete_transcription_job missing, wrong signature, or not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
      and proname = 'fail_transcription_job'
      and pg_get_function_identity_arguments(oid) = '_id uuid, _lease_token uuid, _error text, _terminal boolean'
      and prosecdef) then
    raise exception 'fail_transcription_job missing, wrong signature, or not SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
      and proname = 'reap_stale_transcription_jobs'
      and pg_get_function_identity_arguments(oid) = '_stale_after_seconds integer'
      and prosecdef) then
    raise exception 'reap_stale_transcription_jobs missing, wrong signature, or not SECURITY DEFINER';
  end if;

  -- (d) EXECUTE ACL on each of the four functions: exactly one entry,
  -- service_role, EXECUTE. Read the actual ACL via aclexplode, not
  -- has_function_privilege('public', ...) - PUBLIC is not an ordinary
  -- login role, it is grantee-oid 0 in the ACL itself, and this checks
  -- that directly rather than assuming a role name lookup.
  for v_row in
    select p.proname, p.proowner, a.grantee, a.privilege_type
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('claim_transcription_job', 'complete_transcription_job',
                          'fail_transcription_job', 'reap_stale_transcription_jobs')
       and (p.proname != 'claim_transcription_job'
            or pg_get_function_identity_arguments(p.oid) = '_id uuid, _stale_after_seconds integer')
       and (p.proname != 'complete_transcription_job'
            or pg_get_function_identity_arguments(p.oid) = '_id uuid, _lease_token uuid, _transcript text, _segments jsonb, _word_count integer')
       and (p.proname != 'fail_transcription_job'
            or pg_get_function_identity_arguments(p.oid) = '_id uuid, _lease_token uuid, _error text, _terminal boolean')
       and (p.proname != 'reap_stale_transcription_jobs'
            or pg_get_function_identity_arguments(p.oid) = '_stale_after_seconds integer')
  loop
    if v_row.grantee = 0 then
      raise exception '% still grants EXECUTE to PUBLIC', v_row.proname;
    end if;
    -- Allow service_role, and separately allow the function's own owner:
    -- Postgres materializes a function's default ACL (owner gets EXECUTE
    -- WITH GRANT OPTION, PUBLIC gets plain EXECUTE) the first time any
    -- GRANT/REVOKE runs against a function whose acl was previously NULL.
    -- The owner's own row surviving that is normal - ownership already
    -- grants full rights unconditionally, with or without an ACL row -
    -- and is not reachable by anon/authenticated/PUBLIC. What actually
    -- matters, and what this still rejects, is any OTHER grantee.
    if v_row.grantee::regrole::text <> 'service_role'
       and v_row.grantee <> v_row.proowner then
      raise exception '% grants % to % (expected only service_role or the function owner)', v_row.proname, v_row.privilege_type, v_row.grantee::regrole::text;
    end if;
    if v_row.privilege_type <> 'EXECUTE' then
      raise exception '% grants unexpected privilege % to %', v_row.proname, v_row.privilege_type, v_row.grantee::regrole::text;
    end if;
  end loop;

  -- (e) authenticated/anon still lack UPDATE on voice_explanations
  if has_table_privilege('authenticated', 'public.voice_explanations', 'UPDATE') then
    raise exception 'authenticated unexpectedly still has UPDATE on voice_explanations';
  end if;
  if has_table_privilege('anon', 'public.voice_explanations', 'UPDATE') then
    raise exception 'anon unexpectedly still has UPDATE on voice_explanations';
  end if;

  -- (f) RLS remains enabled
  if not exists (
    select 1 from pg_class where relname = 'voice_explanations'
     and relnamespace = 'public'::regnamespace and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on voice_explanations';
  end if;

  -- (g) prooflab_app and service_role retain UPDATE. prooflab_app is a
  -- production-specific role name (production's confirmed table owner,
  -- Step 6R) - staging has no such role (its owner is postgres), so this
  -- checks existence first rather than assuming the name is universal.
  if exists (select 1 from pg_roles where rolname = 'prooflab_app') then
    if not has_table_privilege('prooflab_app', 'public.voice_explanations', 'UPDATE') then
      raise exception 'prooflab_app unexpectedly lost UPDATE on voice_explanations';
    end if;
  end if;
  if not has_table_privilege('service_role', 'public.voice_explanations', 'UPDATE') then
    raise exception 'service_role unexpectedly lost UPDATE on voice_explanations';
  end if;

  raise notice 'Step 6U: all fail-closed checks passed. Committing.';
end $$;

commit;
notify pgrst, 'reload schema';
