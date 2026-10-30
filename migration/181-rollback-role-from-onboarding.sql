-- Rollback of 181: removes the trigger. Roles already filled stay (they are the student's own onboarding answer).
begin;
drop trigger if exists resume_claims_set_target_role on public.resume_claims;
drop function if exists public.claim_sets_target_role();
commit;
