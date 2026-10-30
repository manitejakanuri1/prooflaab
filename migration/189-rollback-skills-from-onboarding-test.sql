-- Rollback of 189: stop saving skills from the onboarding test. Rows already saved stay (ask before deleting).
begin;
drop trigger if exists resume_scorecards_save_skills on public.resume_scorecards;
drop function if exists public.skills_from_scorecard();
commit;
