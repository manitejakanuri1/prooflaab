-- 87 (staging 5 Oct 2026): browser roles lose PostgreSQL 17's MAINTAIN right on public tables.
--
-- MAINTAIN (the "m" in arwdDxtm) lets a role run VACUUM, ANALYZE, REINDEX, CLUSTER, REFRESH
-- MATERIALIZED VIEW and take strong LOCK TABLE modes. Measured on staging before this migration:
-- anon held it on 75 of 83 public tables, authenticated on 76 (plus 2 of 3 views). These were direct
-- grants left by the old default privileges: not through PUBLIC, no role membership (nobody is in
-- pg_maintain). A signed-in student ran ANALYZE and took a SHARE UPDATE EXCLUSIVE lock on
-- student_credits, where they hold no write right (rolled back).
-- Nothing in the browser, the server functions, the workers, the scheduled jobs or any database
-- function runs a maintenance command; only staging-only load scripts do, as postgres.
-- Revoked from anon and authenticated. service_role and postgres keep theirs. New tables already get
-- nothing for these roles (migration 83); the default-privilege revoke below is repeated so a future
-- default can never hand MAINTAIN back silently.
begin;

revoke maintain on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated;

do $$
declare bad text; probe text;
begin
  -- effective rights, every public table / partitioned table / view / materialized view
  select string_agg(format('%s:%s', r, c.relname), ', ') into bad
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace, unnest(array['anon', 'authenticated']) r
   where ns.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege(r, c.oid, 'MAINTAIN');
  if bad is not null then raise exception '87: browser roles still hold MAINTAIN: %', left(bad, 400); end if;

  -- future tables
  if exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
              where d.defaclobjtype = 'r' and a.grantee in ('anon'::regrole, 'authenticated'::regrole)) then
    raise exception '87: default privileges still give new tables to anon/authenticated';
  end if;

  -- the backend and the owner keep what they had
  if exists (select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
              where ns.nspname = 'public' and c.relkind in ('r', 'p')
                and (not has_table_privilege('postgres', c.oid, 'MAINTAIN')
                     or not has_table_privilege('service_role', c.oid, 'SELECT'))) then
    raise exception '87: postgres lost MAINTAIN or service_role lost SELECT on a public table';
  end if;
  if (select count(*) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
       where ns.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('service_role', c.oid, 'MAINTAIN')) < 81 then
    raise exception '87: service_role lost MAINTAIN on tables it had';
  end if;

  -- behaviour: a signed-in user can no longer take a maintenance-level lock (rolled back with the block)
  begin
    perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    execute 'set local role authenticated';
    begin
      execute 'lock table public.student_credits in share update exclusive mode';
      probe := 'ALLOWED';
    exception when insufficient_privilege then probe := 'denied';
    end;
    execute 'reset role';
    raise exception 'probe87_rollback';
  exception when raise_exception then
    if sqlerrm <> 'probe87_rollback' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  if probe is distinct from 'denied' then raise exception '87: a signed-in user can still take a maintenance lock (%)', probe; end if;
  raise notice '87 self-check: browser MAINTAIN 0; backend/owner kept; maintenance lock as authenticated = %', probe;
end $$;

commit;
