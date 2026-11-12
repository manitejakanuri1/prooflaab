-- Rollback for 230.
begin;
alter function public.tpo_student_profile(uuid) reset timezone;
alter function public.tpo_students(text, text, text, text, text, text, integer, integer) reset timezone;
alter function public.tpo_attention() reset timezone;
alter function public.recruiter_proof_profile(uuid) reset timezone;
commit;
