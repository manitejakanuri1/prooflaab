-- 340 (owner E2E 12 Nov 2026, A6 part 2): every NEW bank question gets a skill at creation, in this order:
--   1. the fixed skill list on the question's own words (unchanged, migration 147);
--   2. migration 331's free source rules, now one shared helper source_skills(): the skill list on the page title +
--      source name, else a whole-source subject for one-subject sources;
--   3. the AI's own pick, sent inside the SAME call that writes the questions (question-decompose; zero extra calls),
--      used only if it is on the skill list.
-- All bank questions are created by question_bank_add (crawler, admin material, college material, scheduled pregenerate),
-- and the trigger runs on every insert, so this covers every path. A question still left with no skill is NOT blocked:
-- it is flagged (provenance.skill_missing) and logged ("question_bank: ... has no skill"), and the admin Question bank
-- screen already counts them ("N match no listed skill").
-- sync_lot_candidate also falls back to source_skills(), so an AI-written Lot from a one-subject source is no longer
-- skill-less; the active skill-less candidates are re-synced here (free).
-- Rollback: migration/340-rollback-new-questions-always-get-a-skill.sql
begin;

create or replace function public.source_skills(_source_content_id uuid)
returns text[] language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((
    select case when cardinality(x.t) > 0 then x.t
                else (select array[m.skill] from (values
                        ('Microsoft ML for Beginners', 'Machine Learning'),
                        ('Microsoft Generative AI for Beginners', 'Machine Learning'),
                        ('Apna Jobs', 'Aptitude')) m(src, skill) where m.src = x.rname) end
      from (select r.name as rname, public.tag_skills(concat_ws(' ', c.title, r.name)) as t
              from public.source_content c left join public.source_registry r on r.id = c.source_id
             where c.id = _source_content_id) x), '{}');
$fn$;
revoke all on function public.source_skills(uuid) from public, anon, authenticated;
grant execute on function public.source_skills(uuid) to service_role;

-- The caller's skill (the AI's pick) is only the last resort, and only if it is on the list.
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

create or replace function public.question_bank_add(_source_content_id uuid, _items jsonb, _provenance jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare it jsonb; stored integer := 0; skipped integer := 0; n integer;
begin
  if _source_content_id is null or not exists (select 1 from public.source_content where id = _source_content_id) then
    raise exception 'unknown source_content_id';
  end if;
  if jsonb_typeof(coalesce(_items, 'null'::jsonb)) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;
  for it in select * from jsonb_array_elements(_items) loop
    begin
      -- 340: skill = the AI's pick; the question_bank_tag trigger keeps it only if no free rule matched and it is on the list
      insert into public.question_bank (source_content_id, question, answer_notes, topic, difficulty, kind, provenance, skill)
      values (_source_content_id, btrim(it ->> 'question'), nullif(btrim(coalesce(it ->> 'answer_notes', '')), ''),
              nullif(btrim(coalesce(it ->> 'topic', '')), ''), it ->> 'difficulty', it ->> 'kind',
              coalesce(_provenance, '{}'::jsonb), left(it ->> 'skill', 60))
      on conflict do nothing;
      get diagnostics n = row_count;
      if n > 0 then stored := stored + 1; else skipped := skipped + 1; end if;
    exception when check_violation or not_null_violation then
      skipped := skipped + 1;
    end;
  end loop;
  insert into public.question_bank_attempts (source_content_id, stored, skipped)
  values (_source_content_id, stored, skipped)
  on conflict (source_content_id) do update
    set attempted_at = now(), stored = excluded.stored, skipped = excluded.skipped;
  return jsonb_build_object('stored', stored, 'skipped', skipped);
end $fn$;

create or replace function public.sync_lot_candidate(_template_id uuid)
returns uuid language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  t  record; sc record; sk text[]; cid uuid;
begin
  select * into t from public.lot_templates where id = _template_id;
  if t is null or t.source_content_id is null then return null; end if;
  select s.id, s.title, s.url, s.canonical_url, s.rights_flag, s.visibility, s.submitted_by_college_id,
         s.bank_question_id, q.skill as bank_skill, g.name as source_name, g.domain
    into sc
    from public.source_content s left join public.source_registry g on g.id = s.source_id
    left join public.question_bank q on q.id = s.bank_question_id
   where s.id = t.source_content_id;
  sk := public.tag_skills(concat_ws(' ', t.title, t.scenario, t.code_sample, sc.title));
  -- 207: a bank page is tagged with its question's own skill first
  if sc.bank_skill is not null and not (sc.bank_skill = any(sk)) then sk := array[sc.bank_skill] || sk; end if;
  if cardinality(sk) = 0 and t.lot_category = 'business' then sk := array['Workplace Writing']; end if;
  -- 340: else the free source rules (page title + source name, one-subject sources)
  if cardinality(sk) = 0 then sk := public.source_skills(t.source_content_id); end if;
  insert into public.lot_candidates as c
    (source_content_id, lot_template_id, skills, topic, difficulty, task_type, grading_mode, provenance, status)
  values
    (t.source_content_id, t.id, sk, sk[1], t.difficulty,
     case when t.sandbox_config_id is not null then 'code' when t.rubric_config_id is not null then 'written' end,
     case when t.sandbox_config_id is not null then 'sandbox' when t.rubric_config_id is not null then 'rubric' end,
     jsonb_build_object('source_content_id', sc.id, 'page_title', sc.title,
                        'url', coalesce(sc.canonical_url, sc.url), 'source_name', sc.source_name,
                        'domain', sc.domain, 'rights_flag', sc.rights_flag, 'visibility', sc.visibility,
                        'template_origin', t.origin, 'tagged_by', 'skill_vocab'),
     -- a written template with a grading config can be chosen; 207: so can a bank page's seed card
     -- (the first student to get it triggers the on-demand writer)
     case when (t.origin <> 'seed' or sc.bank_question_id is not null)
               and (t.sandbox_config_id is not null or t.rubric_config_id is not null)
          then 'active' else 'draft' end)
  on conflict (lot_template_id) do update
     set skills = excluded.skills, topic = excluded.topic, difficulty = excluded.difficulty,
         task_type = excluded.task_type, grading_mode = excluded.grading_mode,
         provenance = excluded.provenance,
         status = case when c.status = 'retired' then 'retired' else excluded.status end,
         updated_at = now()
  returning id into cid;
  return cid;
end $function$;

-- Re-sync the active Lots that have no skill (free; picks up the source fallback).
create temp table st340_before on commit drop as
  select count(*) as n from public.lot_candidates where status = 'active' and cardinality(skills) = 0;
select public.sync_lot_candidate(c.lot_template_id)
  from public.lot_candidates c where c.status = 'active' and cardinality(c.skills) = 0;

do $$
declare before int; after int; qs uuid := gen_random_uuid(); sc uuid; r record;
begin
  select n into before from st340_before;
  select count(*) into after from public.lot_candidates where status = 'active' and cardinality(skills) = 0;
  raise notice '340: active Lots with no skill % -> %', before, after;
  if after > before then raise exception '340 self-check: skill-less Lots went up'; end if;
  -- The trigger on a throwaway question (rolled back by the subtransaction below): AI pick used only as last resort.
  select c.id into sc from public.source_content c join public.source_registry g on g.id = c.source_id
   where g.name = 'Tech Interview Handbook - Career and interview lessons' and cardinality(public.source_skills(c.id)) = 0 limit 1;
  if sc is null then raise exception '340 self-check: no skill-less source page to test on'; end if;
  begin
    begin
      insert into public.question_bank (id, source_content_id, question, kind, skill, status)
        values (qs, sc, 'Self check 340: how would you answer a hard behaviour round question?', 'written', 'machine learning', 'hidden');
      select skill, provenance into r from public.question_bank where id = qs;
      if r.skill is distinct from 'Machine Learning' or r.provenance ->> 'skill_by' <> 'ai' then
        raise exception '340 self-check: AI fallback not used (%, %)', r.skill, r.provenance;
      end if;
      raise exception 'rollback-selfcheck';
    exception when raise_exception then
      if sqlerrm <> 'rollback-selfcheck' then raise; end if;
    end;
    begin
      insert into public.question_bank (id, source_content_id, question, kind, skill, status)
        values (qs, sc, 'Self check 340: how would you answer a hard behaviour round question?', 'written', 'Not A Skill', 'hidden');
      select skill, provenance into r from public.question_bank where id = qs;
      if r.skill is not null or (r.provenance ->> 'skill_missing') is null then
        raise exception '340 self-check: off-list pick not flagged (%, %)', r.skill, r.provenance;
      end if;
      raise exception 'rollback-selfcheck';
    exception when raise_exception then
      if sqlerrm <> 'rollback-selfcheck' then raise; end if;
    end;
  end;
end $$;
commit;
notify pgrst, 'reload schema';
