-- Rollback of 145: removes the two functions. Sections already changed, and seats already released, stay as they are.
begin;
drop function if exists public.tpo_move_student_section(uuid, text);
drop function if exists public.tpo_sections();
commit;
notify pgrst, 'reload schema';
