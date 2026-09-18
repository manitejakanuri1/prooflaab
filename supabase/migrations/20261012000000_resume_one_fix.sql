-- Resume Auto-fix, owner's rules (18 Sep 2026):
--  * only a resume under 60% ATS gets "Auto-fix with AI", and only ONCE per upload;
--  * one AI call rewrites the resume AND re-scores it AND writes next steps and
--    a motivation line; everything is stored so it is never paid for twice;
--  * after the one fix every student may take the assessment.
-- resume_text keeps the uploaded text so the rewrite can keep name, contact,
-- education and experience (the fix used to see only skills/projects/certs).
begin;

alter table public.resume_claims
  add column if not exists resume_text             text,
  add column if not exists improved_ats_score      integer,
  add column if not exists improved_quality_score  integer,
  add column if not exists improve_next_steps      jsonb,
  add column if not exists improve_motivation      text,
  add column if not exists improved_at             timestamptz;

do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'resume_claims'
         and column_name in ('resume_text','improved_ats_score','improved_quality_score',
                             'improve_next_steps','improve_motivation','improved_at')) <> 6 then
    raise exception 'resume_claims columns missing';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
