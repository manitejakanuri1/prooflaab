-- 260 (owner 12 Nov 2026, AI gap chapters): a chapter can be placed between two others and carry its own credit.
--   course_chapters.sort: reading order (starts equal to position; a new chapter gets a value between two
--   neighbours, so positions - and students' read marks - never move). course_chapters.credit: a chapter's own
--   credit line (e.g. "Written for ProofLab" in a course whose other chapters come from outside docs); null = the
--   course's credit. The reader orders by sort and shows the chapter credit first.
-- Rollback: migration/260-rollback-course-chapter-sort-credit.sql
begin;
alter table public.course_chapters add column if not exists sort numeric;
alter table public.course_chapters add column if not exists credit text;
update public.course_chapters set sort = position where sort is null;
alter table public.course_chapters alter column sort set not null;
create index if not exists course_chapters_sort on public.course_chapters (course_slug, sort);
do $$
begin
  if exists (select 1 from public.course_chapters where sort is null) then raise exception '260 self-check: sort missing'; end if;
end $$;
notify pgrst, 'reload schema';
commit;
