-- Rollback for 241 (drops the course tables and every "read" mark).
begin;
drop table if exists public.course_reads, public.course_tracks, public.course_chapters, public.courses;
notify pgrst, 'reload schema';
commit;
