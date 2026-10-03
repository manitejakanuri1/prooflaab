-- ##########################################################################
-- 72: drop task_applications (the old "post a task / students apply" marketplace). PERMANENT.
-- Rehearsed on STAGING. PRODUCTION needs the owner's written yes and a same-hour backup,
-- and goes after the website of this branch is live (older builds still read the table).
-- ##########################################################################
-- The marketplace never worked on this backend (tasks RLS refuses a company insert and
-- students had no screen to apply). Its last readers - the company overview, three hooks
-- and one student query - were removed with the final navigation. Company work is a Lot
-- (company-lot -> company_create_lot); hiring is the shortlist.
-- The file refuses to run if any function, view, policy or foreign key that stays still
-- depends on the table, and copies every row to legacy_archive first.
begin;

do $$
declare bad text; n bigint;
begin
  if to_regclass('public.legacy_archive') is null then raise exception '72: apply 66 first'; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prokind = 'f' and p.prosrc ~ '\mtask_applications\M';
  if bad is not null then raise exception '72: functions still read task_applications: %', bad; end if;
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind in ('v', 'm') and pg_get_viewdef(c.oid) ~ '\mtask_applications\M';
  if bad is not null then raise exception '72: views still read task_applications: %', bad; end if;
  select string_agg(tablename || '.' || policyname, ', ') into bad from pg_policies
   where schemaname = 'public' and tablename <> 'task_applications'
     and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '\mtask_applications\M';
  if bad is not null then raise exception '72: policies on other tables still read task_applications: %', bad; end if;
  select string_agg(conrelid::regclass || '.' || conname, ', ') into bad from pg_constraint
   where contype = 'f' and confrelid = 'public.task_applications'::regclass and conrelid <> 'public.task_applications'::regclass;
  if bad is not null then raise exception '72: foreign keys point at task_applications: %', bad; end if;

  insert into public.legacy_archive (source_table, row_data)
  select 'task_applications', to_jsonb(x) from public.task_applications x;
  get diagnostics n = row_count;
  raise notice '72: archived % task_applications rows', n;
end $$;

drop table public.task_applications;

do $$
begin
  if to_regclass('public.task_applications') is not null then raise exception '72 self-check: the table is still there'; end if;
  if to_regclass('public.task_assignments') is null or to_regclass('public.task_submissions') is null then
    raise exception '72 self-check: a current table went missing';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
