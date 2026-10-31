-- 207 (owner 31 Oct 2026, option B): bank questions become Lots only when a student gets one.
-- Before: the night job (pregenerate-lots) wrote a full AI Lot for every bank question in advance (~Rs 0.25 each),
-- and only those could be picked. Now:
--   1. every live bank page gets a free seed card (seed_lot_template, no AI);
--   2. a seed card on a bank page is a pickable candidate (status 'active'), tagged with the question's own skill;
--   3. the first student who gets it triggers the existing on-demand writer (lot-writer, needs_writer = true),
--      which writes the real Lot once and stores it for every later student.
-- The night job skips bank pages (lot-pipeline.ts pagesNeedingLots). Rollback: 207-rollback-bank-lots-on-demand.sql
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

-- new bank pages get their seed card at once (no AI)
create or replace function public.bank_page_seed()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if new.bank_question_id is not null then perform public.seed_lot_template(new.id); end if;
  return new;
end $function$;
revoke all on function public.bank_page_seed() from public, anon, authenticated;
drop trigger if exists bank_page_seed on public.source_content;
create trigger bank_page_seed after insert on public.source_content
  for each row execute function public.bank_page_seed();

-- existing live bank pages: seed cards now (no AI), then re-sync their candidates
select public.seed_lot_template(sc.id) from public.source_content sc
 where sc.bank_question_id is not null
   and not exists (select 1 from public.lot_templates t where t.source_content_id = sc.id);
select public.sync_lot_candidate(t.id) from public.lot_templates t
  join public.source_content sc on sc.id = t.source_content_id where sc.bank_question_id is not null;

do $$
declare n_pages int; n_active int;
begin
  select count(*) into n_pages from public.source_content where bank_question_id is not null and hidden_at is null;
  select count(*) into n_active from public.source_content sc
    join public.lot_templates t on t.source_content_id = sc.id
    join public.lot_candidates c on c.lot_template_id = t.id and c.status = 'active'
   where sc.bank_question_id is not null and sc.hidden_at is null;
  if n_active < n_pages then raise exception '207: % of % live bank pages are pickable', n_active, n_pages; end if;
  raise notice '207: % live bank pages pickable (seed cards, written on first use)', n_active;
end $$;

notify pgrst, 'reload schema';
commit;
