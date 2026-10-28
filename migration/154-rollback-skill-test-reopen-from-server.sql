-- ROLLBACK for 154: the page goes back to remembering an open test in browser storage only.
-- Roll the functions (resume-question-generator, resume-coding-generate) back first: they call
-- resume_test_open_part.
begin;
drop function if exists public.resume_open_test(uuid, uuid);
drop function if exists public.resume_test_open_part(uuid);
commit;

notify pgrst, 'reload schema';
