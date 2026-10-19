-- Rollback of 123: stop syncing contribution (the values already written stay).
begin;
drop trigger if exists student_weekly_scores_contribution on public.student_weekly_scores;
drop function if exists public.squad_member_contribution_sync();
commit;
