-- Rollback for 290.
begin;
drop function if exists public.college_my_source_material();
drop index if exists public.tasks_source_content_id_idx;
commit;
notify pgrst, 'reload schema';
