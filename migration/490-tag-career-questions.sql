-- 490 (owner E2E 12 Nov 2026, A6): tag the 119 career, interview and ethics bank questions.
-- Migration 341 left 119 questions without a skill; migration 440 made them written Career Lots.
-- Four plain skills added to skill_vocab with keyword rules:
--   - 'Interviewing' (interviews, STAR, candidates, negotiations, offers, resumes)
--   - 'Workplace Ethics' (ethics, integrity, bias, fairness, consent, privacy)
--   - 'Professional Communication' (communication, storytelling, presentations, charts, teamwork)
--   - 'Career Readiness' (career growth, study strategies, engineering practices, project goals)
-- Auto-tag question_bank_tag() updated to pick up career skills.
-- Rollback: migration/490-rollback-tag-career-questions.sql
begin;

insert into public.skill_vocab (skill, pattern) values
  ('Workplace Ethics', '\m(ethics?|ethical|unethical|conflict of interest|confidential(ity)?|plagiaris[mt]?|whistleblow(er|ing)?|honest(y)?|integrit(y)?|bias(es|ed)?|fairness|compliance|code of conduct|harassment|discriminat(ion|ory)?|professional conduct|data privacy|privacy|consent|gdpr|deceptive|manipulat(ive|ion)|cherry[- ]pick(ing)?)\M'),
  ('Interviewing', '\m(interview(s|ing|er|ee)?|star(\(r\))?|behavioral|self introduction|candidate(s)?|hire(d|s|ing)?|hiring manager|recruiter(s)?|negotiat(e|ing|ion)|offer(s)?|salary|compensation|base salary|equity|resume(s)?|curriculum vitae|cv|cover letter|screening|mock negotiation|questions to ask)\M'),
  ('Professional Communication', '\m(communicat(e|ion|ing)|storytelling|presentation(s)?|slide(s)?|audience(s)?|visuali[zs](e|ation|ing)|chart(s)?|pie chart|bar chart|waffle chart|proportion chart|dashboard(s)?|stakeholder(s)?|client(s)?|teamwork|collaborat(e|ion|ive)|listening|feedback|meeting(s)?|report(s|ing)?|memo(s)?|public speaking|verbal|written communication|colorblind|accessibility|encoding)\M'),
  ('Career Readiness', '\m(career(s)?|professional|workplace|job(s)?|industry|mentor(s|ship)?|networking|leadership|time management|prioriti[zs](e|ation)|problem[- ]solving|critical thinking|growth mindset|work[- ]life|study tip(s)?|study guide|study strategy|anki|flashcards?|learning approach|trade[- ]offs?|system design|engineering communit(y|ies)|staff[- ]plus|learning path|onboarding|freemium|gating|programming|translator|vscode|command palette|mcp|cloud deployment|cosmos db|lifecycle|maintenance|requirements gathering|data science|paradigm|structured data|unstructured data|cold data|hot data|storage|storage options|promotion|extension|collision|game|graduate|dean''s list|degree|project goals?)\M')
on conflict (skill) do update set pattern = excluded.pattern;

-- Update existing untagged bank questions
update public.question_bank q
   set skills = coalesce(nullif(public.tag_skills(concat_ws(' ', q.topic, q.question, q.answer_notes)), '{}'), array['Career Readiness'::text]),
       skill = coalesce((public.tag_skills(concat_ws(' ', q.topic, q.question, q.answer_notes)))[1], 'Career Readiness'),
       provenance = coalesce(q.provenance, '{}'::jsonb) || '{"skill_by": "career_tag_490"}'::jsonb
 where q.skill is null;

-- Re-sync candidates for the updated questions
select public.sync_lot_candidate(t.id)
  from public.lot_templates t
  join public.source_content s on s.id = t.source_content_id
  join public.question_bank q on q.id = s.bank_question_id
 where q.provenance ->> 'skill_by' = 'career_tag_490';

-- Auto-tag for new questions: falls back to Career Readiness if topic is career-related
create or replace function public.question_bank_tag()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare tags text[]; how text := 'question'; ai text;
begin
  select v.skill into ai from public.skill_vocab v where lower(v.skill) = lower(btrim(coalesce(new.skill, '')));
  tags := public.tag_skills(coalesce(new.question, '') || ' ' || coalesce(new.answer_notes, '') || ' ' || coalesce(new.topic, ''));
  if cardinality(tags) = 0 then tags := public.source_skills(new.source_content_id); how := 'source'; end if;
  if cardinality(tags) = 0 and ai is not null then tags := array[ai]; how := 'ai'; end if;
  -- 490 (A6): fallback for career / interview / ethics / communication questions
  if cardinality(tags) = 0 and coalesce(new.topic, '') ~* '\m(interview|career|resume|placement|ethics|communication)\M' then
    tags := array['Career Readiness'::text]; how := 'career_fallback';
  end if;
  new.skills := tags;
  new.skill := tags[1];
  if new.skill is null then
    new.provenance := coalesce(new.provenance, '{}'::jsonb) || '{"skill_missing": true}'::jsonb;
    raise log 'question_bank: new question % has no skill (no rule matched, no AI pick on the list)', new.id;
  else
    new.provenance := coalesce(new.provenance, '{}'::jsonb) || jsonb_build_object('skill_by', how);
  end if;
  return new;
end $fn$;

do $$
declare
  untagged int;
begin
  select count(*) into untagged from public.question_bank where skill is null;
  if untagged > 0 then
    raise exception '490 self-check failed: % questions still have no skill', untagged;
  end if;
  if not ('Interviewing' = any(public.tag_skills('Interview preparation and STAR questions'))) then
    raise exception '490 self-check failed: Interviewing tag rule';
  end if;
  if not ('Workplace Ethics' = any(public.tag_skills('Code of conduct and ethics at work'))) then
    raise exception '490 self-check failed: Workplace Ethics tag rule';
  end if;
  if not ('Professional Communication' = any(public.tag_skills('Storytelling and presentation to stakeholders'))) then
    raise exception '490 self-check failed: Professional Communication tag rule';
  end if;
  if not ('Career Readiness' = any(public.tag_skills('Engineering career path and study tips'))) then
    raise exception '490 self-check failed: Career Readiness tag rule';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
