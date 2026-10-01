begin;
create temp table m49orig as select p.oid, p.proname, md5(p.prosrc) h, p.proacl::text acl, p.proowner o
  from pg_proc p where p.oid in ('public.tpo_college_report()'::regprocedure, 'public.tpo_placement_report()'::regprocedure);

create temp table m49 on commit drop as
select p.oid, p.proname, p.prosrc as old_src, p.proacl::text as acl, p.prosecdef, p.proconfig::text as cfg,
       p.proowner, p.provolatile, pg_get_function_result(p.oid) as result
  from pg_proc p
 where p.oid in ('public.tpo_college_report()'::regprocedure, 'public.tpo_placement_report()'::regprocedure);

do $$
declare
  r record;
  old_line constant text := 'cid uuid := coalesce(public.my_college_id(), public.viewer_college_id());';
  new_line constant text := 'cid uuid := public.my_college_id();';
  n int;
begin
  if (select count(*) from m49) <> 2 then
    raise exception '49: expected 2 functions, found %', (select count(*) from m49);
  end if;
  for r in select * from m49 loop
    n := (length(r.old_src) - length(replace(r.old_src, old_line, ''))) / length(old_line);
    if n <> 1 then
      raise exception '49: % contains the college line % times (expected 1) - nothing changed', r.proname, n;
    end if;
    if r.result <> 'jsonb' or not r.prosecdef or r.cfg is distinct from '{"search_path=public, pg_temp"}' then
      raise exception '49: % is not the expected SECURITY DEFINER jsonb function (%, %)', r.proname, r.result, r.cfg;
    end if;
    execute format(
      'create or replace function public.%I() returns jsonb language plpgsql %s security definer set search_path = public, pg_temp as %L',
      r.proname, case r.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end,
      replace(r.old_src, old_line, new_line));
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select m.proname, m.old_src, m.acl, m.prosecdef, m.cfg, m.proowner, m.provolatile,
                  p.prosrc as new_src, p.proacl::text as new_acl, p.prosecdef as new_secdef, p.proconfig::text as new_cfg,
                  p.proowner as new_owner, p.provolatile as new_vol
             from m49 m join pg_proc p on p.oid = m.oid loop
    if r.new_src <> replace(r.old_src, 'cid uuid := coalesce(public.my_college_id(), public.viewer_college_id());',
                                       'cid uuid := public.my_college_id();') then
      raise exception '49 check: % body differs beyond the one line', r.proname;
    end if;
    if position('viewer_college_id' in r.new_src) > 0 then
      raise exception '49 check: % still uses viewer_college_id', r.proname;
    end if;
    if r.new_acl is distinct from r.acl or r.new_secdef <> r.prosecdef or r.new_cfg is distinct from r.cfg
       or r.new_owner <> r.proowner or r.new_vol <> r.provolatile then
      raise exception '49 check: % grants/owner/security/search_path/volatility changed', r.proname;
    end if;
  end loop;
end $$;


select 'after-49', p.proname, position('viewer_college_id' in p.prosrc) > 0 as still_fallback from pg_proc p join m49orig m on m.oid=p.oid order by 2;
-- 49 ROLLBACK: put back the pre-49 college line in tpo_college_report() and tpo_placement_report().
--
-- Use only if Migration 49 must be undone. Works on the LIVE body (like 49 itself): the
-- migration-49 line must occur exactly once; afterwards each body must equal the current body
-- with only that line swapped back, contain viewer_college_id again, and keep owner, SECURITY
-- DEFINER, search_path, volatility and EXECUTE grants unchanged. Any failure rolls back.
-- Undoing 49 re-opens the G28 privacy gap (students can read their college's reports).


create temp table m49r on commit drop as
select p.oid, p.proname, p.prosrc as old_src, p.proacl::text as acl, p.prosecdef, p.proconfig::text as cfg,
       p.proowner, p.provolatile, pg_get_function_result(p.oid) as result
  from pg_proc p
 where p.oid in ('public.tpo_college_report()'::regprocedure, 'public.tpo_placement_report()'::regprocedure);

do $$
declare
  r record;
  old_line constant text := 'cid uuid := public.my_college_id();';
  new_line constant text := 'cid uuid := coalesce(public.my_college_id(), public.viewer_college_id());';
  n int;
begin
  if (select count(*) from m49r) <> 2 then
    raise exception '49 rollback: expected 2 functions, found %', (select count(*) from m49r);
  end if;
  for r in select * from m49r loop
    n := (length(r.old_src) - length(replace(r.old_src, old_line, ''))) / length(old_line);
    if n <> 1 then
      raise exception '49 rollback: % contains the migration-49 line % times (expected 1) - nothing changed', r.proname, n;
    end if;
    if r.result <> 'jsonb' or not r.prosecdef or r.cfg is distinct from '{"search_path=public, pg_temp"}' then
      raise exception '49 rollback: % is not the expected SECURITY DEFINER jsonb function (%, %)', r.proname, r.result, r.cfg;
    end if;
    execute format(
      'create or replace function public.%I() returns jsonb language plpgsql %s security definer set search_path = public, pg_temp as %L',
      r.proname, case r.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end,
      replace(r.old_src, old_line, new_line));
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select m.proname, m.old_src, m.acl, m.prosecdef, m.cfg, m.proowner, m.provolatile,
                  p.prosrc as new_src, p.proacl::text as new_acl, p.prosecdef as new_secdef, p.proconfig::text as new_cfg,
                  p.proowner as new_owner, p.provolatile as new_vol
             from m49r m join pg_proc p on p.oid = m.oid loop
    if r.new_src <> replace(r.old_src, 'cid uuid := public.my_college_id();',
                                       'cid uuid := coalesce(public.my_college_id(), public.viewer_college_id());') then
      raise exception '49 rollback check: % body differs beyond the one line', r.proname;
    end if;
    if position('viewer_college_id' in r.new_src) = 0 then
      raise exception '49 rollback check: % does not use viewer_college_id again', r.proname;
    end if;
    if r.new_acl is distinct from r.acl or r.new_secdef <> r.prosecdef or r.new_cfg is distinct from r.cfg
       or r.new_owner <> r.proowner or r.new_vol <> r.provolatile then
      raise exception '49 rollback check: % grants/owner/security/search_path/volatility changed', r.proname;
    end if;
  end loop;
end $$;


select 'after-rollback', p.proname, md5(p.prosrc) = m.h as body_identical, p.proacl::text = m.acl as acl_same, p.proowner = m.o as owner_same
  from pg_proc p join m49orig m on m.oid=p.oid order by 2;
rollback;
select 'REHEARSAL-END';
