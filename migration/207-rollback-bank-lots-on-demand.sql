-- Rollback of 207: old candidate rule (seed cards never pickable), no seed trigger. Seed cards stay (unused, draft).
begin;
create or replace function public.sync_lot_candidate(_template_id uuid)
returns uuid
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  t  record; sc record; sk text[]; cid uuid;
begin
  select * into t from public.lot_templates where id = _template_id;
  if t is null or t.source_content_id is null then return null; end if;
  select s.id, s.title, s.url, s.canonical_url, s.rights_flag, s.visibility, s.submitted_by_college_id,
         g.name as source_name, g.domain
    into sc
    from public.source_content s left join public.source_registry g on g.id = s.source_id
   where s.id = t.source_content_id;
  sk := public.tag_skills(concat_ws(' ', t.title, t.scenario, t.code_sample, sc.title));
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
     -- only a written template with a grading config can be chosen by the evidence rules
     case when t.origin <> 'seed' and (t.sandbox_config_id is not null or t.rubric_config_id is not null)
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
drop trigger if exists bank_page_seed on public.source_content;
drop function if exists public.bank_page_seed();
select public.sync_lot_candidate(t.id) from public.lot_templates t
  join public.source_content sc on sc.id = t.source_content_id where sc.bank_question_id is not null;
notify pgrst, 'reload schema';
commit;
