-- Year group check (TEST only, migration 183): batch text fills passing_out_year on import and on change. ROLLS BACK.
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/year_group_check.sql
\set ON_ERROR_STOP on
\pset pager off
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'Not the TEST database. Refusing.'; end if; end $$;
begin;
create temp table r (n int, what text, ok boolean);
do $$
declare sid uuid; y int := public.school_year(current_date);
begin
  perform set_config('app.system_write', 'on', true);
  select id into sid from public.student_profiles where college_id = (select id from public.colleges where name = 'PRAGATI') limit 1;
  update public.student_profiles set batch = '2nd year' where id = sid;
  insert into r values (1, 'Batch "2nd year" is passing out ' || (y + 3) || ' and shows "2nd year"',
    (select passing_out_year = y + 3 and public.year_group_label(passing_out_year) = '2nd year' from public.student_profiles where id = sid));
  update public.student_profiles set batch = 'Third Year' where id = sid;
  insert into r values (2, 'Changing the batch updates the year', (select passing_out_year = y + 2 from public.student_profiles where id = sid));
  update public.student_profiles set batch = 'not a year' where id = sid;
  insert into r values (3, 'An unreadable batch keeps the year it had', (select passing_out_year = y + 2 from public.student_profiles where id = sid));
  insert into r values (4, 'Next June the same student is one year up',
    (select public.year_group_label(passing_out_year, make_date(y + 1, 6, 1)) = '4th year' from public.student_profiles where id = sid));
end $$;
select n, what, case when ok then 'PASS' else 'FAIL' end as result from r order by n;
select count(*) filter (where ok) || ' of ' || count(*) || ' pass' as total from r;
rollback;
