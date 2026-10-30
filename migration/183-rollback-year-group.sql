-- Rollback of 183: removes the year-group trigger and functions and the passing_out_year column.
begin;
drop trigger if exists student_profiles_batch_sets_year on public.student_profiles;
drop function if exists public.student_batch_sets_year();
drop function if exists public.year_group_label(integer, date);
drop function if exists public.passing_out_year_of(text, date);
alter table public.student_profiles drop column if exists passing_out_year;
notify pgrst, 'reload schema';
commit;
