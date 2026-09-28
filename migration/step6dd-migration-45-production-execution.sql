-- Step 6DD: production execution of migration 45, self-contained.
--
-- PREPARED, NOT APPLIED. Run only after the project owner's explicit
-- approval for this one change, manually via Cloud SQL Studio on
-- prooflab-db / database prooflab, connected as prooflab_app.
--
-- What 45 does (see migration/45-voice-scoring-lease-token.sql):
--   - adds voice_explanations.scoring_lease_token uuid
--   - DROPS migration 44's claim_voice_scoring(uuid, integer) -> boolean
--     and recreates it as -> table(claimed boolean, lease_token uuid)
--     (Postgres cannot change a function's return type in place)
--   - adds complete_voice_scoring(uuid, uuid, integer, text) -> boolean
--   - adds fail_voice_scoring(uuid, uuid, text) -> boolean
--   - locks all three down to service_role only
--
-- Dependency on 44: 45 REPLACES 44's function and uses 44's column
-- (scoring_claimed_at). It must only ever run on a database whose
-- claim_voice_scoring is exactly 44's boolean shape. The pre-check below
-- enforces that, so:
--   - on a database without 44          -> aborts, nothing changed
--   - on a database already carrying 45 -> aborts, nothing changed
--     (this is what keeps a mistaken re-run, or a run against staging,
--     from dropping and recreating an existing 45 function)
--
-- The DROP in 45 is deliberate and safe here ONLY because the pre-check
-- has already proven the thing being dropped is 44's boolean version.
--
-- Differences from the original migration file, all additive:
--   1. set local lock_timeout: ALTER TABLE needs a brief ACCESS EXCLUSIVE
--      lock on voice_explanations. Without a timeout it could queue behind
--      a long transaction and block every voice read/write while it waits.
--      With it, the script aborts after 5 s instead (nothing changed).
--   2. pre-checks and fail-closed post-checks, INSIDE the transaction,
--      BEFORE COMMIT (a post-commit check cannot undo anything).
--   3. the original's own begin/commit/notify are removed; one outer
--      transaction wraps everything.
-- Every DDL statement is copied verbatim from
-- migration/45-voice-scoring-lease-token.sql. That file is not modified.

begin;

set local lock_timeout = '5s';

-- ============================================================
-- pre-checks: prove this database is exactly "44 applied, 45 not"
-- ============================================================
do $$
declare
  v_result text;
  v_count  integer;
  v_type   text;
begin
  -- (1) migration 44's column is present
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'voice_explanations'
        and column_name = 'scoring_claimed_at') then
    raise exception 'pre-check: scoring_claimed_at missing - migration 44 is not applied here; refusing to run 45';
  end if;

  -- (2) exactly one claim_voice_scoring, with 44's signature and boolean result
  select count(*) into v_count from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'claim_voice_scoring';
  if v_count <> 1 then
    raise exception 'pre-check: expected exactly 1 claim_voice_scoring, found % - refusing to run', v_count;
  end if;
  select pg_get_function_result(oid) into v_result from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'claim_voice_scoring'
     and oidvectortypes(proargtypes) = 'uuid, integer';
  if v_result is null then
    raise exception 'pre-check: claim_voice_scoring(uuid, integer) not found - refusing to run';
  end if;
  if v_result <> 'boolean' then
    raise exception 'pre-check: claim_voice_scoring(uuid,integer) returns % (expected boolean) - this database is already past migration 44 (likely 45 is applied); refusing to drop and recreate it', v_result;
  end if;

  -- (3) 45's other two functions must not exist in ANY shape yet
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('complete_voice_scoring', 'fail_voice_scoring')) then
    raise exception 'pre-check: complete_voice_scoring / fail_voice_scoring already exist - database is not in the expected "44 only" state; refusing to run';
  end if;

  -- (4) the lease column must be absent, or already uuid (never another type)
  select data_type into v_type from information_schema.columns
   where table_schema = 'public' and table_name = 'voice_explanations'
     and column_name = 'scoring_lease_token';
  if v_type is not null and v_type <> 'uuid' then
    raise exception 'pre-check: scoring_lease_token exists with type % (expected uuid) - refusing to run', v_type;
  end if;

  -- (5) columns the new functions write must exist. plpgsql does NOT
  -- check these at CREATE time - a missing one would only fail later, at
  -- runtime, inside voice-score.
  select count(*) into v_count from information_schema.columns
   where table_schema = 'public' and table_name = 'voice_explanations'
     and column_name in ('id', 'status', 'communication_score', 'communication_notes');
  if v_count <> 4 then
    raise exception 'pre-check: voice_explanations is missing one of id/status/communication_score/communication_notes (found % of 4)', v_count;
  end if;

  -- (6) gen_random_uuid() (used by the new claim) resolves
  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'pre-check: gen_random_uuid() not available';
  end if;

  raise notice 'Step 6DD pre-checks passed: database is at migration 44, not 45.';
end $$;

-- ============================================================
-- migration 45 body (verbatim statements)
-- ============================================================

alter table public.voice_explanations
  add column if not exists scoring_lease_token uuid;

drop function if exists public.claim_voice_scoring(uuid, integer);
create or replace function public.claim_voice_scoring(_id uuid, _claim_ttl_seconds integer default 120)
returns table (claimed boolean, lease_token uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  _lease uuid := gen_random_uuid();
  n integer;
begin
  update public.voice_explanations
     set scoring_claimed_at = now(),
         scoring_lease_token = _lease
   where id = _id
     and status <> 'scored'
     and (scoring_claimed_at is null
          or scoring_claimed_at < now() - make_interval(secs => _claim_ttl_seconds));
  get diagnostics n = row_count;
  if n > 0 then
    return query select true, _lease;
  else
    return query select false, null::uuid;
  end if;
end $function$;

create or replace function public.complete_voice_scoring(
  _id uuid, _lease_token uuid, _score integer, _notes text
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  update public.voice_explanations
     set communication_score = _score,
         communication_notes = _notes,
         status = 'scored'
   where id = _id and scoring_lease_token = _lease_token;
  get diagnostics n = row_count;
  return n > 0;
end $function$;

create or replace function public.fail_voice_scoring(
  _id uuid, _lease_token uuid, _notes text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  update public.voice_explanations
     set status = 'failed',
         communication_notes = coalesce(_notes, communication_notes),
         scoring_claimed_at = null,
         scoring_lease_token = null
   where id = _id and scoring_lease_token = _lease_token;
  get diagnostics n = row_count;
  return n > 0;
end $function$;

revoke all on function
  public.claim_voice_scoring(uuid, integer),
  public.complete_voice_scoring(uuid, uuid, integer, text),
  public.fail_voice_scoring(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function
  public.claim_voice_scoring(uuid, integer),
  public.complete_voice_scoring(uuid, uuid, integer, text),
  public.fail_voice_scoring(uuid, uuid, text)
  to service_role;

-- ============================================================
-- fail-closed verification, INSIDE the transaction, BEFORE commit.
-- Any failure raises, the transaction aborts, nothing is kept.
-- ============================================================
do $$
declare
  v_table_owner oid;
  v_fn record;
  v_acl record;
begin
  -- (a) new column, right type
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'voice_explanations'
        and column_name = 'scoring_lease_token' and data_type = 'uuid') then
    raise exception 'post-check: scoring_lease_token uuid column missing';
  end if;
  if not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'voice_explanations'
        and column_name = 'scoring_claimed_at') then
    raise exception 'post-check: scoring_claimed_at column disappeared';
  end if;

  select relowner into v_table_owner from pg_class
   where oid = 'public.voice_explanations'::regclass;

  -- (b) exactly the three expected functions, expected shapes
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('claim_voice_scoring', 'complete_voice_scoring', 'fail_voice_scoring')) <> 3 then
    raise exception 'post-check: expected exactly 3 voice scoring functions (no stray overloads)';
  end if;

  for v_fn in
    select p.oid, p.proname, oidvectortypes(p.proargtypes) as args,
           pg_get_function_result(p.oid) as result, p.prosecdef, p.proowner, p.proconfig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('claim_voice_scoring', 'complete_voice_scoring', 'fail_voice_scoring')
  loop
    if v_fn.proname = 'claim_voice_scoring'
       and (v_fn.args <> 'uuid, integer' or v_fn.result <> 'TABLE(claimed boolean, lease_token uuid)') then
      raise exception 'post-check: claim_voice_scoring is (%) -> % (expected (uuid, integer) -> TABLE(claimed boolean, lease_token uuid))', v_fn.args, v_fn.result;
    end if;
    if v_fn.proname = 'complete_voice_scoring'
       and (v_fn.args <> 'uuid, uuid, integer, text' or v_fn.result <> 'boolean') then
      raise exception 'post-check: complete_voice_scoring is (%) -> %', v_fn.args, v_fn.result;
    end if;
    if v_fn.proname = 'fail_voice_scoring'
       and (v_fn.args <> 'uuid, uuid, text' or v_fn.result <> 'boolean') then
      raise exception 'post-check: fail_voice_scoring is (%) -> %', v_fn.args, v_fn.result;
    end if;
    if not v_fn.prosecdef then
      raise exception 'post-check: % is not SECURITY DEFINER', v_fn.proname;
    end if;
    if v_fn.proconfig is null or not ('search_path=public, pg_temp' = any (v_fn.proconfig)) then
      raise exception 'post-check: % has no pinned search_path (got %)', v_fn.proname, v_fn.proconfig;
    end if;
    -- same owner as the table, so SECURITY DEFINER runs as the table owner
    if v_fn.proowner <> v_table_owner then
      raise exception 'post-check: % owned by %, table owned by % - owners must match',
        v_fn.proname, v_fn.proowner::regrole::text, v_table_owner::regrole::text;
    end if;

    -- (c) EXECUTE: service_role yes; anon, authenticated, PUBLIC no
    if not has_function_privilege('service_role', v_fn.oid, 'EXECUTE') then
      raise exception 'post-check: % missing service_role EXECUTE', v_fn.proname;
    end if;
    if has_function_privilege('anon', v_fn.oid, 'EXECUTE') then
      raise exception 'post-check: anon can EXECUTE %', v_fn.proname;
    end if;
    if has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') then
      raise exception 'post-check: authenticated can EXECUTE %', v_fn.proname;
    end if;
    for v_acl in
      select a.grantee, a.privilege_type
        from aclexplode(coalesce((select proacl from pg_proc where oid = v_fn.oid),
                                 acldefault('f', v_fn.proowner))) a
    loop
      if v_acl.grantee = 0 then
        raise exception 'post-check: % still grants EXECUTE to PUBLIC', v_fn.proname;
      end if;
      if v_acl.grantee::regrole::text <> 'service_role' and v_acl.grantee <> v_fn.proowner then
        raise exception 'post-check: % grants % to % (expected only service_role or the owner)',
          v_fn.proname, v_acl.privilege_type, v_acl.grantee::regrole::text;
      end if;
    end loop;
  end loop;

  -- (d) regression guard: already-applied production state (41-44, 47)
  if has_table_privilege('authenticated', 'public.voice_explanations', 'UPDATE') then
    raise exception 'regression: authenticated has UPDATE on voice_explanations';
  end if;
  if has_table_privilege('anon', 'public.voice_explanations', 'UPDATE') then
    raise exception 'regression: anon has UPDATE on voice_explanations';
  end if;
  if not has_table_privilege('service_role', 'public.voice_explanations', 'UPDATE') then
    raise exception 'regression: service_role lost UPDATE on voice_explanations';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.voice_explanations'::regclass and relrowsecurity) then
    raise exception 'regression: RLS is not enabled on voice_explanations';
  end if;
  if to_regprocedure('public.guard_voice_explanations_insert()') is null then
    raise exception 'regression: guard_voice_explanations_insert() (migration 43) is missing';
  end if;

  raise notice 'Step 6DD: all fail-closed checks passed. Committing.';
end $$;

commit;
notify pgrst, 'reload schema';
