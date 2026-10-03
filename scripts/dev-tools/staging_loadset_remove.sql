-- STAGING ONLY. Removes the synthetic dataset written by staging_loadset.sql and nothing else.
-- Every row it removes is identified by the LOADTEST markers; deleting the accounts cascades to
-- profiles, tasks, submissions, recordings and squad memberships.
\set ON_ERROR_STOP on
do $$
begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception 'This is not the staging database. Refusing.';
  end if;
end $$;
begin;
select set_config('app.system_write', 'on', true);
delete from public.squads s using public.colleges c where c.id = s.college_id and c.name like 'LOADTEST College %';
delete from auth.users where email like 'load.%@loadtest.invalid';
delete from public.colleges where name like 'LOADTEST College %';
delete from auth.users where email like 'college%@loadtest.invalid';
commit;
vacuum analyze;
select 'LOADSET removed; students left=' || (select count(*) from public.student_profiles)
    || ' db=' || pg_size_pretty(pg_database_size(current_database()));
