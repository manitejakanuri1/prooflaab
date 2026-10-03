-- Rollback of 62: removes import_student_record(). Re-deploy the previous functions image first
-- (the current create-student-users calls it).
drop function if exists public.import_student_record(uuid, uuid, text, text, text, text, text[], text[], text, text, text, text, uuid);
notify pgrst, 'reload schema';
