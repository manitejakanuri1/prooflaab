-- The Auto-fix results are written by the server only; a student must not be
-- able to set their own improved score or mark the fix as done from the browser.
begin;
drop trigger if exists protect_resume_claims on public.resume_claims;
create trigger protect_resume_claims before update on public.resume_claims
  for each row execute function public.protect_columns(
    'resume_quality_score', 'ats_match_score', 'resume_quality_notes',
    'ats_match_notes', 'skill_relevance_notes', 'ai_improved_resume', 'raw_extraction',
    'resume_text', 'improved_ats_score', 'improved_quality_score',
    'improve_next_steps', 'improve_motivation', 'improved_at');
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'protect_resume_claims') then
    raise exception 'protect trigger missing';
  end if;
end $$;
commit;
