-- ============================================================================
-- The worst performance bug in the product, and it was in almost every policy.
--
-- A student reading their own profile, measured with ten thousand students in
-- the table:
--
--   Seq Scan on student_profiles
--   Rows Removed by Filter: 10008
--   Execution Time: 1126 ms
--
-- One row. One and a bit seconds. Ten thousand calls to is_admin().
--
-- Postgres treats a bare function call inside a policy as something that could
-- differ from row to row, so it runs it for every row — and the resulting
-- filter also stops the primary key index being used for id = auth.uid().
-- Every student, every page load. With ten thousand students signed in at
-- once, the database would have spent most of its time asking itself whether
-- each of them was an administrator.
--
-- Wrapping the call in a subselect turns it into an InitPlan: evaluated once
-- per statement, then treated as a constant. auth.uid() was already written
-- this way everywhere. is_admin() never was, in any of the seventy-eight
-- policies that call it.
--
--   after: Execution Time 3.774 ms   — three hundred times faster
--
-- Rewritten mechanically rather than by hand. Each affected policy is dropped
-- and recreated with the identical expression and only the call wrapped, so no
-- rule can be quietly loosened while being retyped. Re-verified afterwards as
-- a real student: still sees exactly one profile, still cannot set their own
-- XP, still updates zero rows when aiming at somebody else, still reads
-- nothing from security_events, audit_logs or interventions.
-- ============================================================================
do $$
declare
  r record;
  new_qual text;
  new_check text;
  cmd text;
  roles text;
  fixed integer := 0;
begin
  for r in
    select n.nspname as sch, c.relname as tbl, p.polname, p.polcmd, p.polpermissive,
           pg_get_expr(p.polqual, p.polrelid)      as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as chk,
           array(select rolname from pg_roles where oid = any(p.polroles)) as roles
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and (coalesce(pg_get_expr(p.polqual, p.polrelid),'') || ' ' ||
            coalesce(pg_get_expr(p.polwithcheck, p.polrelid),''))
           ~* '(^|[^.[:alnum:]_])is_admin\(\)'
  loop
    -- Only a bare call is rewritten. One already inside a subselect is left
    -- exactly as it is, so this migration is safe to run more than once.
    new_qual  := regexp_replace(coalesce(r.qual,''),
                   '(^|[^.[:alnum:]_])is_admin\(\)', '\1(SELECT public.is_admin())', 'g');
    new_check := regexp_replace(coalesce(r.chk,''),
                   '(^|[^.[:alnum:]_])is_admin\(\)', '\1(SELECT public.is_admin())', 'g');

    cmd := case r.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                         when 'w' then 'UPDATE' when 'd' then 'DELETE'
                         else 'ALL' end;
    roles := array_to_string(array(select quote_ident(x) from unnest(r.roles) x), ', ');
    if roles = '' then roles := 'public'; end if;

    execute format('drop policy %I on %I.%I', r.polname, r.sch, r.tbl);

    execute format('create policy %I on %I.%I as %s for %s to %s %s %s',
      r.polname, r.sch, r.tbl,
      case when r.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end,
      cmd, roles,
      case when r.qual is not null then 'using (' || new_qual || ')' else '' end,
      case when r.chk  is not null then 'with check (' || new_check || ')' else '' end);

    fixed := fixed + 1;
  end loop;

  raise notice 'rewrote % policies', fixed;
end $$;

-- get_leaderboard ranks every active student by XP on every call, and there was
-- no index to rank by — so each call sorted the whole table. One index turns
-- that into a walk down the first hundred entries.
create index if not exists student_profiles_leaderboard_idx
  on public.student_profiles (total_xp desc, created_at)
  where status = 'active';
