-- Rollback of 198: removes the Accept check. The notice wording stays (harmless).
begin;
drop trigger if exists shortlist_needs_student_yes on public.recruiter_shortlists;
drop function if exists public.shortlist_needs_student_yes();
commit;
