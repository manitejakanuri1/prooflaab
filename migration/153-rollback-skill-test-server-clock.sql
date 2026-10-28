-- ROLLBACK for 153: the skill test clock goes back to the browser only. The saved deadlines and answers are
-- dropped; submitted tests keep their answers in resume_assessments.student_answers as before.
begin;
drop function if exists public.resume_test_answer(uuid, text, jsonb);
drop function if exists public.resume_test_clock(uuid, text);
drop table if exists public.resume_question_clock;
commit;

notify pgrst, 'reload schema';
