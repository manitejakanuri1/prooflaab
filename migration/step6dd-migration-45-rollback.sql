-- Step 6DD: UNDO of step6dd-migration-45-production-execution.sql.
--
-- EMERGENCY USE ONLY, and only with the project owner's explicit approval.
-- Puts the database back to the "migration 44 applied" state:
--   - drops complete_voice_scoring and fail_voice_scoring
--   - drops the table-returning claim_voice_scoring and recreates
--     migration 44's boolean claim_voice_scoring (verbatim from
--     migration/44-voice-scoring-claim.sql), service_role only
--   - KEEPS the scoring_lease_token column (dropping it would need a
--     longer lock and gains nothing; 44's code never reads it)
--
-- DO NOT run this while any deployed voice-score code calls
-- complete_voice_scoring / fail_voice_scoring or expects the table-shaped
-- claim (the Step 6 branch code does): voice scoring would start failing.
-- The main-branch voice-score calls none of them.
--
-- Pre-check: refuses to run unless the database carries exactly the
-- Step 6DD-fixed 45 (all four guards present). It therefore refuses on
-- staging, which runs the unfixed original 45, and on a database at 44.

begin;

set local lock_timeout = '5s';

do $$
declare v_src text;
begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('claim_voice_scoring', 'complete_voice_scoring', 'fail_voice_scoring')) <> 3 then
    raise exception 'rollback pre-check: expected exactly the 3 migration-45 functions; refusing';
  end if;
  select prosrc into v_src from pg_proc where pronamespace = 'public'::regnamespace
     and proname = 'claim_voice_scoring' and oidvectortypes(proargtypes) = 'uuid, integer'
     and pg_get_function_result(oid) = 'TABLE(claimed boolean, lease_token uuid)';
  if v_src is null or position('_claim_ttl_seconds < 1' in v_src) = 0 then
    raise exception 'rollback pre-check: claim_voice_scoring is not the Step 6DD-fixed 45 version; refusing';
  end if;
  select prosrc into v_src from pg_proc where pronamespace = 'public'::regnamespace
     and proname = 'complete_voice_scoring' and oidvectortypes(proargtypes) = 'uuid, uuid, integer, text';
  if v_src is null or position('and status <> ''scored''' in v_src) = 0
     or position('_score < 0 or _score > 100' in v_src) = 0 then
    raise exception 'rollback pre-check: complete_voice_scoring is not the Step 6DD-fixed 45 version; refusing';
  end if;
  select prosrc into v_src from pg_proc where pronamespace = 'public'::regnamespace
     and proname = 'fail_voice_scoring' and oidvectortypes(proargtypes) = 'uuid, uuid, text';
  if v_src is null or position('and status <> ''scored''' in v_src) = 0 then
    raise exception 'rollback pre-check: fail_voice_scoring is not the Step 6DD-fixed 45 version; refusing';
  end if;
  raise notice 'Step 6DD rollback pre-checks passed: database carries the fixed 45.';
end $$;

drop function public.complete_voice_scoring(uuid, uuid, integer, text);
drop function public.fail_voice_scoring(uuid, uuid, text);
drop function public.claim_voice_scoring(uuid, integer);

-- migration 44's function, verbatim
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

do $$
declare v_foid oid; v_acl record; v_owner oid;
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('complete_voice_scoring', 'fail_voice_scoring')) then
    raise exception 'rollback post-check: complete/fail_voice_scoring still exist';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
       and proname = 'claim_voice_scoring') <> 1 then
    raise exception 'rollback post-check: expected exactly one claim_voice_scoring';
  end if;
  select oid, proowner into v_foid, v_owner from pg_proc where pronamespace = 'public'::regnamespace
     and proname = 'claim_voice_scoring' and oidvectortypes(proargtypes) = 'uuid, integer';
  if v_foid is null or pg_get_function_result(v_foid) <> 'boolean' then
    raise exception 'rollback post-check: claim_voice_scoring is not 44''s boolean shape';
  end if;
  if not (select prosecdef from pg_proc where oid = v_foid) then
    raise exception 'rollback post-check: claim_voice_scoring is not SECURITY DEFINER';
  end if;
  if v_owner <> (select relowner from pg_class where oid = 'public.voice_explanations'::regclass) then
    raise exception 'rollback post-check: claim_voice_scoring owner differs from the table owner';
  end if;
  if not has_function_privilege('service_role', v_foid, 'EXECUTE')
     or has_function_privilege('anon', v_foid, 'EXECUTE')
     or has_function_privilege('authenticated', v_foid, 'EXECUTE') then
    raise exception 'rollback post-check: EXECUTE must be service_role only';
  end if;
  for v_acl in select a.grantee from aclexplode(coalesce((select proacl from pg_proc where oid = v_foid),
                                                         acldefault('f', v_owner))) a loop
    if v_acl.grantee = 0 then raise exception 'rollback post-check: PUBLIC has EXECUTE'; end if;
    if v_acl.grantee::regrole::text <> 'service_role' and v_acl.grantee <> v_owner then
      raise exception 'rollback post-check: unexpected grantee %', v_acl.grantee::regrole::text;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.voice_explanations', 'UPDATE')
     or has_table_privilege('anon', 'public.voice_explanations', 'UPDATE') then
    raise exception 'rollback regression: browser roles have UPDATE on voice_explanations';
  end if;
  raise notice 'Step 6DD rollback: all post-checks passed. Committing.';
end $$;

commit;
notify pgrst, 'reload schema';
