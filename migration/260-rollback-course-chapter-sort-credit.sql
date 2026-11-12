-- Rollback for 260 (drops the AI-written chapters' placement and credit; delete those chapters first if needed).
begin;
drop index if exists public.course_chapters_sort;
alter table public.course_chapters drop column if exists credit;
alter table public.course_chapters drop column if exists sort;
notify pgrst, 'reload schema';
commit;
