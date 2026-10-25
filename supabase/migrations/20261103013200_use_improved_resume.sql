-- 142: "Download & continue with this resume" after the one-time Auto-fix. Owner decision, 24 Oct 2026.
--
--   1. resume_claims gets improve_changes (what the AI changed, written by resume-improve in the same AI call),
--      original_ats_score / original_quality_score / original_resume_text (kept to show old -> new) and
--      improved_applied_at.
--   2. use_improved_resume(claim): the student's own claim, only after Auto-fix, only once. The AI-improved text
--      and its two scores become the resume's; the assessment and Interview Readiness then use them.
--      The uploaded file is not deleted.
--   3. the new columns are server-owned (protect_columns), like the other Auto-fix columns.
-- Rollback: migration/142-rollback-use-improved-resume.sql
begin;

alter table public.resume_claims
  add column if not exists improve_changes        jsonb,
  add column if not exists original_ats_score     integer,
  add column if not exists original_quality_score integer,
  add column if not exists original_resume_text   text,
  add column if not exists improved_applied_at    timestamptz;

drop trigger if exists protect_resume_claims on public.resume_claims;
create trigger protect_resume_claims before update on public.resume_claims
  for each row execute function public.protect_columns(
    'resume_quality_score', 'ats_match_score', 'resume_quality_notes',
    'ats_match_notes', 'skill_relevance_notes', 'ai_improved_resume', 'raw_extraction',
    'resume_text', 'improved_ats_score', 'improved_quality_score',
    'improve_next_steps', 'improve_motivation', 'improved_at',
    'improve_changes', 'original_ats_score', 'original_quality_score', 'original_resume_text',
    'improved_applied_at');

create or replace function public.use_improved_resume(_claim_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; prev text := coalesce(current_setting('app.system_write', true), '');
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into c from public.resume_claims where id = _claim_id;
  if c is null then raise exception 'no such resume'; end if;
  if c.student_id is distinct from auth.uid() then raise exception 'not yours'; end if;
  if c.improved_at is null or c.ai_improved_resume is null then raise exception 'use Auto-fix first'; end if;
  if c.improved_applied_at is null then
    perform set_config('app.system_write', 'on', true);
    update public.resume_claims
       set original_ats_score = ats_match_score, original_quality_score = resume_quality_score,
           original_resume_text = resume_text,
           ats_match_score = improved_ats_score, resume_quality_score = improved_quality_score,
           resume_text = ai_improved_resume, improved_applied_at = now()
     where id = _claim_id;
    perform set_config('app.system_write', prev, true);
  end if;
  select * into c from public.resume_claims where id = _claim_id;
  return jsonb_build_object('ats_match_score', c.ats_match_score, 'resume_quality_score', c.resume_quality_score,
                            'original_ats_score', c.original_ats_score, 'original_quality_score', c.original_quality_score,
                            'improved_applied_at', c.improved_applied_at);
end $$;

revoke all on function public.use_improved_resume(uuid) from public, anon;
grant execute on function public.use_improved_resume(uuid) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'resume_claims'
                  and column_name = 'improved_applied_at')
     or not has_function_privilege('authenticated', 'public.use_improved_resume(uuid)', 'execute')
     or has_function_privilege('anon', 'public.use_improved_resume(uuid)', 'execute')
     or not exists (select 1 from pg_trigger where tgname = 'protect_resume_claims') then
    raise exception '142: not applied as written';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
