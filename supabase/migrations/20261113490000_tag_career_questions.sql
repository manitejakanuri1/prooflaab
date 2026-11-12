-- 490 (owner E2E 12 Nov 2026, A6): tag the 119 career, interview and ethics bank questions, no AI.
-- Migration 341 left 119 questions without a skill; migration 440 made them written Career Lots.
-- One skill, 'Career Readiness', with a deliberately narrow pattern: skill_vocab is shared by every
-- tagger (Lots, resumes, questions), so broad words like "report" or "job" would mis-tag technical work.
-- The 119 untagged questions get it directly. New questions that mention career / workplace ethics /
-- behavioural interviews / salary negotiation pick it up through the normal tag_skills() rule.
-- Rollback: migration/490-rollback-tag-career-questions.sql
begin;

insert into public.skill_vocab (skill, pattern) values
  ('Career Readiness', '\m(careers?|workplace ethics|behaviou?ral interviews?|salary negotiation)\M')
on conflict (skill) do update set pattern = excluded.pattern;

update public.question_bank q
   set skills = array['Career Readiness'::text],
       skill = 'Career Readiness',
       provenance = coalesce(q.provenance, '{}'::jsonb) || '{"skill_by": "career_tag_490"}'::jsonb
 where q.skill is null;

-- Re-sync candidates for the updated questions
select public.sync_lot_candidate(t.id)
  from public.lot_templates t
  join public.source_content s on s.id = t.source_content_id
  join public.question_bank q on q.id = s.bank_question_id
 where q.provenance ->> 'skill_by' = 'career_tag_490';

do $$
declare untagged int;
begin
  select count(*) into untagged from public.question_bank where skill is null;
  if untagged > 0 then raise exception '490 self-check failed: % questions still have no skill', untagged; end if;
  if not ('Career Readiness' = any(public.tag_skills('a behavioural interview about workplace ethics'))) then
    raise exception '490 self-check failed: Career Readiness rule'; end if;
  if 'Career Readiness' = any(public.tag_skills('write a SQL report for the job queue')) then
    raise exception '490 self-check failed: rule too broad'; end if;
  raise notice '490 self-check: true';
end $$;

notify pgrst, 'reload schema';
commit;
