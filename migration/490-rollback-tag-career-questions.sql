-- Rollback of 490: restore question_bank skills and skill_vocab before 490
begin;

-- Clear tags on questions tagged by 490
update public.question_bank
   set skill = null,
       skills = '{}',
       provenance = provenance - 'skill_by'
 where provenance ->> 'skill_by' = 'career_tag_490';

-- Restore 340 definition of question_bank_tag
create or replace function public.question_bank_tag()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare tags text[]; how text := 'question'; ai text;
begin
  select v.skill into ai from public.skill_vocab v where lower(v.skill) = lower(btrim(coalesce(new.skill, '')));
  tags := public.tag_skills(coalesce(new.question, '') || ' ' || coalesce(new.answer_notes, '') || ' ' || coalesce(new.topic, ''));
  if cardinality(tags) = 0 then tags := public.source_skills(new.source_content_id); how := 'source'; end if;
  if cardinality(tags) = 0 and ai is not null then tags := array[ai]; how := 'ai'; end if;
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

-- Remove the four skills from skill_vocab
delete from public.skill_vocab
 where skill in ('Interviewing', 'Workplace Ethics', 'Professional Communication', 'Career Readiness');

do $$
begin
  if exists (select 1 from public.skill_vocab where skill in ('Interviewing', 'Workplace Ethics', 'Professional Communication', 'Career Readiness')) then
    raise exception '490 rollback self-check failed: skills still present';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
