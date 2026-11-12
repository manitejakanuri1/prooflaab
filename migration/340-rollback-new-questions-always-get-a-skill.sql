-- Rollback of 340: the trigger, question_bank_add and sync_lot_candidate go back to their 147/207 versions and the
-- source_skills helper is dropped. Skills already written stay (they are correct tags; 331/341 rollbacks clear theirs).
begin;
create or replace function public.question_bank_tag()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare tags text[];
begin
  tags := public.tag_skills(coalesce(new.question, '') || ' ' || coalesce(new.answer_notes, '') || ' ' || coalesce(new.topic, ''));
  new.skills := tags;
  new.skill := tags[1];
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
      insert into public.question_bank (source_content_id, question, answer_notes, topic, difficulty, kind, provenance)
      values (_source_content_id, btrim(it ->> 'question'), nullif(btrim(coalesce(it ->> 'answer_notes', '')), ''),
              nullif(btrim(coalesce(it ->> 'topic', '')), ''), it ->> 'difficulty', it ->> 'kind',
              coalesce(_provenance, '{}'::jsonb))
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

drop function if exists public.source_skills(uuid);
do $$ begin
  if exists (select 1 from pg_proc where proname = 'source_skills') then raise exception '340 rollback failed'; end if;
end $$;
commit;
notify pgrst, 'reload schema';
