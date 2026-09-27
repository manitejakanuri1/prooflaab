-- Step 6Y: production execution of migration 43, self-contained (unlike
-- 41, which required combining with 42 to avoid an intermediate broad-
-- EXECUTE exposure). Migration 43 already locks down
-- claim_transcription_recovery's grants in its own transaction, right
-- after creating it - create-then-lock-down in one statement group, the
-- same safe order 42 established. No later migration (44/45/46) touches
-- claim_transcription_recovery or guard_voice_explanations_insert, so
-- this can ship alone.
--
-- Fail-closed checks are INSIDE the transaction, BEFORE COMMIT, for the
-- same reason as the 41+42 script: a post-commit check cannot undo
-- anything once COMMIT succeeds, and Cloud SQL Studio opens a new
-- session per execution, so this must be one paste, one transaction.
--
-- Every statement below is copied verbatim from
-- migration/43-transcription-durable-recovery.sql, with only its own
-- individual BEGIN/COMMIT/NOTIFY removed. The original migration file is
-- NOT modified.

begin;

-- ============================================================
-- migration 43 body (unmodified statements)
-- ============================================================

alter table public.voice_explanations
  add column if not exists transcription_enqueued_at timestamptz,
  add column if not exists transcription_reap_claimed_at timestamptz,
  add column if not exists transcription_reap_attempts integer not null default 0;

drop function if exists public.reap_stale_transcription_jobs(integer);
drop function if exists public.claim_transcription_recovery(integer, integer, integer, integer);

create or replace function public.claim_transcription_recovery(
  _stale_after_seconds integer default 180,
  _pending_grace_seconds integer default 20,
  _reap_claim_ttl_seconds integer default 60,
  _max_reap_attempts integer default 8
)
returns table (id uuid, storage_path text, kind text, attempt integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.voice_explanations
     set transcription_status = 'failed',
         transcription_error = 'exceeded automatic recovery attempts'
   where transcription_status in ('pending', 'processing')
     and transcription_reap_attempts >= _max_reap_attempts;

  return query
  update public.voice_explanations v
     set transcription_reap_claimed_at = now(),
         transcription_reap_attempts = v.transcription_reap_attempts + 1
   where v.transcription_reap_attempts < _max_reap_attempts
     and (v.transcription_reap_claimed_at is null
          or v.transcription_reap_claimed_at < now() - make_interval(secs => _reap_claim_ttl_seconds))
     and (
       (v.transcription_status = 'pending'
        and v.transcription_enqueued_at is null
        and v.created_at < now() - make_interval(secs => _pending_grace_seconds))
       or
       (v.transcription_status = 'processing'
        and v.transcription_claimed_at < now() - make_interval(secs => _stale_after_seconds))
     )
  returning v.id, v.storage_path,
    (case when v.transcription_status = 'pending' then 'pending' else 'processing' end),
    v.transcription_reap_attempts;
end $function$;

revoke all on function public.claim_transcription_recovery(integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_transcription_recovery(integer, integer, integer, integer)
  to service_role;

create or replace function public.guard_voice_explanations_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.student_id = new.student_id
  ) then
    raise exception 'task_id does not belong to this student';
  end if;
  if new.proof_id is not null and not exists (
    select 1 from public.proof_uploads p where p.id = new.proof_id and p.student_id = new.student_id
  ) then
    raise exception 'proof_id does not belong to this student';
  end if;

  new.transcript_source := 'browser';
  new.status := 'recorded';
  new.communication_score := null;
  new.communication_notes := null;
  new.word_count := case
    when new.transcript is not null and length(trim(new.transcript)) > 0
    then array_length(regexp_split_to_array(trim(new.transcript), '\s+'), 1)
    else 0
  end;
  new.transcription_status := 'completed';
  new.transcription_idempotency_key := null;
  new.transcription_claimed_at := null;
  new.transcription_attempts := 0;
  new.transcription_error := null;
  new.transcription_lease_token := null;
  new.transcription_enqueued_at := null;
  new.transcription_reap_claimed_at := null;
  new.transcription_reap_attempts := 0;
  return new;
end $function$;

drop trigger if exists guard_voice_explanations_insert on public.voice_explanations;
create trigger guard_voice_explanations_insert
  before insert on public.voice_explanations
  for each row execute function public.guard_voice_explanations_insert();

-- Step 6Z addition, not part of migration 43's original file: the
-- original migration never revoked the default PUBLIC EXECUTE that
-- CREATE FUNCTION applies automatically - confirmed as a real gap on
-- staging (public_exec/anon_exec/auth_exec all true before this fix).
-- No GRANT is added for any role: a trigger's function is invoked
-- directly by the trigger manager as part of the INSERT operation, not
-- called as an ordinary RPC, so EXECUTE privilege is never checked for
-- trigger firing - only for a direct SELECT/CALL-style invocation, which
-- nothing legitimate ever does to a trigger function. Revoking PUBLIC
-- here closes that direct-invocation surface without affecting the
-- trigger itself - verified below by pre-check, staging ACL, and a live
-- simulated-session insert that must still succeed after this revoke.
revoke execute on function public.guard_voice_explanations_insert()
  from public, anon, authenticated;

-- ============================================================
-- fail-closed verification, INSIDE the transaction, BEFORE commit.
-- ============================================================

do $$
declare
  v_count integer;
  v_row record;
  v_acl_row record;
  v_foid oid;
  t_recovery text := 'integer, integer, integer, integer';
  t_old_reap text := 'integer';
begin
  -- (a) all three new columns exist
  select count(*) into v_count from information_schema.columns
   where table_schema = 'public' and table_name = 'voice_explanations'
     and column_name in ('transcription_enqueued_at', 'transcription_reap_claimed_at',
       'transcription_reap_attempts');
  if v_count <> 3 then
    raise exception 'expected 3 new columns on voice_explanations, found %', v_count;
  end if;

  -- (b) the old bare reap_stale_transcription_jobs(integer) is gone -
  -- superseded by claim_transcription_recovery. Check pg_depend first:
  -- if anything genuinely depended on it, the DROP above would already
  -- have failed outright (no CASCADE was used) rather than silently
  -- succeeding, so reaching this point at all is itself evidence nothing
  -- did - this just re-confirms the object itself is truly gone.
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
      and proname = 'reap_stale_transcription_jobs' and oidvectortypes(proargtypes) = t_old_reap) then
    raise exception 'reap_stale_transcription_jobs(integer) still exists - should have been dropped and superseded';
  end if;

  -- (c) claim_transcription_recovery exists, correct signature, SECURITY
  -- DEFINER, and returns the expected columns (checked by name, since
  -- pg_get_function_result's column list is a fixed, unambiguous format
  -- unrelated to the parameter-naming issue found in Step 6W).
  select oid into v_foid from pg_proc where pronamespace = 'public'::regnamespace
   and proname = 'claim_transcription_recovery' and oidvectortypes(proargtypes) = t_recovery;
  if v_foid is null then
    raise exception 'claim_transcription_recovery missing or wrong argument signature';
  end if;
  if not exists (select 1 from pg_proc where oid = v_foid and prosecdef) then
    raise exception 'claim_transcription_recovery is not SECURITY DEFINER';
  end if;
  if not (
    (select pg_get_function_result(v_foid)) ilike '%storage_path%'
    and (select pg_get_function_result(v_foid)) ilike '%kind%'
    and (select pg_get_function_result(v_foid)) ilike '%attempt%'
  ) then
    raise exception 'claim_transcription_recovery does not return the expected columns';
  end if;

  -- (d) EXECUTE: service_role required, anon/authenticated/PUBLIC rejected
  if not has_function_privilege('service_role', v_foid, 'EXECUTE') then
    raise exception 'claim_transcription_recovery: service_role EXECUTE grant is missing (required)';
  end if;
  if has_function_privilege('anon', v_foid, 'EXECUTE') then
    raise exception 'claim_transcription_recovery: anon unexpectedly has EXECUTE';
  end if;
  if has_function_privilege('authenticated', v_foid, 'EXECUTE') then
    raise exception 'claim_transcription_recovery: authenticated unexpectedly has EXECUTE';
  end if;
  for v_acl_row in
    select a.grantee, a.privilege_type, (select proowner from pg_proc where oid = v_foid) as proowner
      from aclexplode(coalesce((select proacl from pg_proc where oid = v_foid),
                                acldefault('f', (select proowner from pg_proc where oid = v_foid)))) a
  loop
    if v_acl_row.grantee = 0 then
      raise exception 'claim_transcription_recovery still grants EXECUTE to PUBLIC';
    end if;
    if v_acl_row.grantee::regrole::text <> 'service_role' and v_acl_row.grantee <> v_acl_row.proowner then
      raise exception 'claim_transcription_recovery grants % to % (expected only service_role or the function owner)', v_acl_row.privilege_type, v_acl_row.grantee::regrole::text;
    end if;
    if v_acl_row.privilege_type <> 'EXECUTE' then
      raise exception 'claim_transcription_recovery grants unexpected privilege % to %', v_acl_row.privilege_type, v_acl_row.grantee::regrole::text;
    end if;
  end loop;

  -- (e) guard_voice_explanations_insert trigger present, enabled, BEFORE INSERT
  if not exists (
    select 1 from pg_trigger where tgrelid = 'public.voice_explanations'::regclass
     and tgname = 'guard_voice_explanations_insert' and not tgisinternal
     and tgenabled <> 'D'
  ) then
    raise exception 'guard_voice_explanations_insert trigger missing or disabled';
  end if;

  -- (f) the guard function itself exists (zero-argument trigger
  -- function - checked by pronargs, not oidvectortypes, to avoid relying
  -- on an unverified empty-string rendering) and is SECURITY DEFINER
  select oid into v_foid from pg_proc where pronamespace = 'public'::regnamespace
   and proname = 'guard_voice_explanations_insert' and pronargs = 0;
  if v_foid is null then
    raise exception 'guard_voice_explanations_insert() function missing';
  end if;
  if not exists (select 1 from pg_proc where oid = v_foid and prosecdef) then
    raise exception 'guard_voice_explanations_insert() is not SECURITY DEFINER';
  end if;

  -- (f2) Step 6Z: PUBLIC/anon/authenticated must NOT have EXECUTE on the
  -- trigger function itself - a real gap confirmed on staging before
  -- this fix (all three were true). No positive service_role
  -- requirement here, unlike the RPC-style functions in the 41+42
  -- script: nothing ever calls this function directly, including
  -- service_role - it only ever runs as the trigger manager's own
  -- invocation, which does not check EXECUTE at all.
  if has_function_privilege('public', v_foid, 'EXECUTE') then
    raise exception 'guard_voice_explanations_insert(): PUBLIC unexpectedly has EXECUTE';
  end if;
  if has_function_privilege('anon', v_foid, 'EXECUTE') then
    raise exception 'guard_voice_explanations_insert(): anon unexpectedly has EXECUTE';
  end if;
  if has_function_privilege('authenticated', v_foid, 'EXECUTE') then
    raise exception 'guard_voice_explanations_insert(): authenticated unexpectedly has EXECUTE';
  end if;

  -- (g) regression guard: table-level UPDATE grants unchanged from
  -- migration 47's applied state - this migration must not touch them
  if has_table_privilege('authenticated', 'public.voice_explanations', 'UPDATE') then
    raise exception 'authenticated unexpectedly has UPDATE on voice_explanations (regression)';
  end if;
  if has_table_privilege('anon', 'public.voice_explanations', 'UPDATE') then
    raise exception 'anon unexpectedly has UPDATE on voice_explanations (regression)';
  end if;
  if not has_table_privilege('service_role', 'public.voice_explanations', 'UPDATE') then
    raise exception 'service_role unexpectedly lost UPDATE on voice_explanations (regression)';
  end if;
  if exists (select 1 from pg_roles where rolname = 'prooflab_app') then
    if not has_table_privilege('prooflab_app', 'public.voice_explanations', 'UPDATE') then
      raise exception 'prooflab_app unexpectedly lost UPDATE on voice_explanations (regression)';
    end if;
  end if;

  -- (h) RLS remains enabled
  if not exists (
    select 1 from pg_class where relname = 'voice_explanations'
     and relnamespace = 'public'::regnamespace and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on voice_explanations';
  end if;

  raise notice 'Step 6Z: all fail-closed checks passed. Committing.';
end $$;

commit;
notify pgrst, 'reload schema';
