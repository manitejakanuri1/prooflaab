-- Rollback of 176: removes the trigger. The profiles already marked 'completed' stay completed (that is true).
begin;
drop trigger if exists student_intake_marks_onboarded on public.student_intake;
drop function if exists public.intake_marks_onboarded();
commit;
