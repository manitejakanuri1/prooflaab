-- Step 6BB: production execution of migration 44, self-contained.
--
-- Migration 44 already locks down claim_voice_scoring's grants in its
-- own transaction, right after creating it (revoke all from public,
-- anon, authenticated; grant to service_role) - the same safe
-- create-then-lock-down order 42 established, so it needs no combining
-- with anything else.
--
-- DELIBERATELY NOT adding a defensive "drop function if exists" before
-- the create, unlike the fix applied to claim_transcription_job in Step
-- 6U. That fix was needed there only because a rehearsal target
-- (staging) already carried a LATER migration's different return shape
-- of the SAME function under the SAME input signature. The identical
-- situation exists here: staging already has migration 45's
-- claim_voice_scoring (returns table(claimed boolean, lease_token uuid),
-- not boolean). Production has neither today (confirmed throughout this
-- engagement - migrations 41-43 and 47 applied, 44-46 not). A defensive
-- drop-first here would make this script SILENTLY REGRESS a database
-- already past migration 44 back down to the weaker boolean-only shape
-- if ever mistakenly re-run - exactly the risk this must guard against,
-- not paper over. The pre-check immediately below does that guarding
-- instead of a blind drop.
--
-- Fail-closed checks are INSIDE the transaction, BEFORE COMMIT, for the
-- same reason as every other script this engagement has produced: a
-- post-commit check cannot undo anything once COMMIT succeeds.
--
-- Every DDL statement below is copied verbatim from
-- migration/44-voice-scoring-claim.sql, with only its own individual
-- BEGIN/COMMIT/NOTIFY removed. The original migration file is NOT
-- modified.

begin;

-- ============================================================
-- pre-check: refuse to run against a database already past migration
-- 44's shape for this function (e.g. one already carrying migration
-- 45). This is what makes it safe to even ATTEMPT this script against
-- an unknown or wrong target - it aborts cleanly instead of downgrading
-- anything.
-- ============================================================
do $$
declare v_result text;
begin
  select pg_get_function_result(oid) into v_result
    from pg_proc where pronamespace = 'public'::regnamespace
     and proname = 'claim_voice_scoring' and oidvectortypes(proargtypes) = 'uuid, integer';
  if v_result is not null and v_result <> 'boolean' then
    raise exception 'claim_voice_scoring(uuid,integer) already exists with return type % (expected boolean, or absent) - this database has already moved past migration 44 (likely migration 45 is applied); refusing to run migration 44 here, it would regress a newer function', v_result;
  end if;
end $$;

-- ============================================================
-- migration 44 body (unmodified statements)
-- ============================================================

alter table public.voice_explanations
  add column if not exists scoring_claimed_at timestamptz;

create or replace function public.claim_voice_scoring(_id uuid, _claim_ttl_seconds integer default 120)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  update public.voice_explanations
     set scoring_claimed_at = now()
   where id = _id
     and status <> 'scored'
     and (scoring_claimed_at is null
          or scoring_claimed_at < now() - make_interval(secs => _claim_ttl_seconds));
  get diagnostics n = row_count;
  return n > 0;
end $function$;

revoke all on function public.claim_voice_scoring(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_voice_scoring(uuid, integer) to service_role;

-- ============================================================
-- fail-closed verification, INSIDE the transaction, BEFORE commit.
-- ============================================================

do $$
declare
  v_foid oid;
  v_acl_row record;
begin
  -- (a) the new column exists
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'voice_explanations'
        and column_name = 'scoring_claimed_at') then
    raise exception 'scoring_claimed_at column missing on voice_explanations';
  end if;

  -- (b) claim_voice_scoring exists with exactly migration 44's shape:
  -- boolean return, SECURITY DEFINER
  select oid into v_foid from pg_proc where pronamespace = 'public'::regnamespace
   and proname = 'claim_voice_scoring' and oidvectortypes(proargtypes) = 'uuid, integer';
  if v_foid is null then
    raise exception 'claim_voice_scoring(uuid,integer) missing after create';
  end if;
  if pg_get_function_result(v_foid) <> 'boolean' then
    raise exception 'claim_voice_scoring has unexpected return type % (expected boolean)', pg_get_function_result(v_foid);
  end if;
  if not exists (select 1 from pg_proc where oid = v_foid and prosecdef) then
    raise exception 'claim_voice_scoring is not SECURITY DEFINER';
  end if;

  -- (c) EXECUTE: service_role required, anon/authenticated/PUBLIC rejected
  if not has_function_privilege('service_role', v_foid, 'EXECUTE') then
    raise exception 'claim_voice_scoring: service_role EXECUTE grant is missing (required)';
  end if;
  if has_function_privilege('anon', v_foid, 'EXECUTE') then
    raise exception 'claim_voice_scoring: anon unexpectedly has EXECUTE';
  end if;
  if has_function_privilege('authenticated', v_foid, 'EXECUTE') then
    raise exception 'claim_voice_scoring: authenticated unexpectedly has EXECUTE';
  end if;
  for v_acl_row in
    select a.grantee, a.privilege_type, (select proowner from pg_proc where oid = v_foid) as proowner
      from aclexplode(coalesce((select proacl from pg_proc where oid = v_foid),
                                acldefault('f', (select proowner from pg_proc where oid = v_foid)))) a
  loop
    if v_acl_row.grantee = 0 then
      raise exception 'claim_voice_scoring still grants EXECUTE to PUBLIC';
    end if;
    if v_acl_row.grantee::regrole::text <> 'service_role' and v_acl_row.grantee <> v_acl_row.proowner then
      raise exception 'claim_voice_scoring grants % to % (expected only service_role or the function owner)', v_acl_row.privilege_type, v_acl_row.grantee::regrole::text;
    end if;
    if v_acl_row.privilege_type <> 'EXECUTE' then
      raise exception 'claim_voice_scoring grants unexpected privilege % to %', v_acl_row.privilege_type, v_acl_row.grantee::regrole::text;
    end if;
  end loop;

  -- (d) regression guard: unrelated, already-applied production state
  -- (migrations 41-43, 47) must not have changed
  if has_table_privilege('authenticated', 'public.voice_explanations', 'UPDATE') then
    raise exception 'regression: authenticated unexpectedly has UPDATE on voice_explanations';
  end if;
  if has_table_privilege('anon', 'public.voice_explanations', 'UPDATE') then
    raise exception 'regression: anon unexpectedly has UPDATE on voice_explanations';
  end if;
  if not has_table_privilege('service_role', 'public.voice_explanations', 'UPDATE') then
    raise exception 'regression: service_role unexpectedly lost UPDATE on voice_explanations';
  end if;
  if exists (select 1 from pg_roles where rolname = 'prooflab_app') then
    if not has_table_privilege('prooflab_app', 'public.voice_explanations', 'UPDATE') then
      raise exception 'regression: prooflab_app unexpectedly lost UPDATE on voice_explanations';
    end if;
  end if;
  if not exists (
    select 1 from pg_class where relname = 'voice_explanations'
     and relnamespace = 'public'::regnamespace and relrowsecurity
  ) then
    raise exception 'RLS is not enabled on voice_explanations';
  end if;

  raise notice 'Step 6BB: all fail-closed checks passed. Committing.';
end $$;

commit;
notify pgrst, 'reload schema';
