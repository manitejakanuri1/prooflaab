-- 49: college-only reports must not answer students.
--
-- tpo_college_report() and tpo_placement_report() are called only from the college
-- dashboard (TpoInsights) and say "Only a college can read this report." But they
-- resolve the college with coalesce(my_college_id(), viewer_college_id()), and
-- viewer_college_id() falls back to the CALLER'S OWN student_profiles.college_id. So a
-- signed-in student got their college's reports; tpo_placement_report includes
-- classmates' names and the companies that hired them. Found 1 Oct 2026 by the
-- authorization matrix (scripts/dev-tools/authz_matrix_check.py); 0 hires recorded, so
-- nothing was exposed.
--
-- Fix: in both, that one line becomes `cid uuid := public.my_college_id();`. The first
-- branch of viewer_college_id() is exactly my_college_id() (an approved college
-- account), so college accounts see no change.
--
-- The live body is used as the source (staging and production were restored at
-- different times, so byte-exact repository bodies are not assumed). Fail-closed: the
-- old line must occur exactly once; afterwards the new body must equal the old body
-- with only that line replaced, and owner, SECURITY DEFINER, search_path, volatility
-- and EXECUTE grants must be unchanged. Any failure rolls everything back.

begin;

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

commit;
