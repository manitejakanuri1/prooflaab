-- 222: never show an unwritten Lot (sweep S3, owner 11 Nov 2026).
--
-- create_lot_for used to hand out a page's seed template ("The full task is being prepared") and wait for the
-- paid writer to fill it. On TEST the writer does not run, so 88 Lots stayed unwritten. Now, when the chosen
-- page only has a seed, the student gets a ready template (already written, with tests or a marking guide)
-- they have not had, same kind first, in a stable per-student order. No AI is called. If no ready template
-- is left, the old path (seed + writer) stays.
--
-- Rollback: migration/222-rollback-ready-lot-not-seed.sql
begin;

CREATE OR REPLACE FUNCTION public.create_lot_for(_student_id uuid, _for_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
declare
  d    date := coalesce(_for_date, current_date);
  pick jsonb;
  scid uuid;
  cand uuid;
  tpl  record;
  n    integer;
  tid  uuid;
  cur  record;
begin
  select t.id, t.source_content_id into cur
    from public.tasks t where t.student_id = _student_id and t.lot_date = d limit 1;
  if cur.id is not null then
    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'source_content_id', cur.source_content_id,
                              'needs_writer', public.lot_needs_writer(cur.id));
  end if;
  if public.lot_day_kind(d) = 'rest' then
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
      'reason', 'rest day', 'needs_writer', false);
  end if;
  -- 184: no Daily Lot in the days off between two seasons (roadmap only)
  if public.in_season_gap(_student_id) is not null then
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
      'reason', 'between seasons', 'next_season_at', public.in_season_gap(_student_id), 'needs_writer', false);
  end if;
  pick := public.next_lot_pick(_student_id, d);
  scid := (pick->>'source_content_id')::uuid;
  cand := (pick->>'candidate_id')::uuid;
  if scid is null then
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
      'reason', 'no content available', 'needs_writer', false);
  end if;
  if cand is not null then
    select t.* into tpl from public.lot_templates t
      join public.lot_candidates c on c.lot_template_id = t.id where c.id = cand;
  end if;
  if tpl is null then
    select * into tpl from public.lot_templates where source_content_id = scid;
  end if;
  if tpl is null then
    perform public.seed_lot_template(scid);
    select * into tpl from public.lot_templates where source_content_id = scid;
    cand := (select c.id from public.lot_candidates c where c.lot_template_id = tpl.id);
  end if;
  if tpl is null then
    return jsonb_build_object('ok', false, 'reason', 'no template', 'needs_writer', false);
  end if;

  -- 222 (sweep S3, owner 11 Nov 2026): never hand out an unwritten Lot. If this page's template is still the
  -- seed, give a ready (written) template this student has not had, same kind first. No AI is called.
  -- Only when no ready template is left does the seed stay (the writer then fills it, as before).
  if tpl.origin = 'seed' then
    declare r record;
    begin
      select t.* into r
        from public.lot_templates t
       where t.origin = 'ai'
         and coalesce(t.sandbox_config_id, t.rubric_config_id) is not null
         and not exists (select 1 from public.tasks k
                          where k.student_id = _student_id and k.source_content_id = t.source_content_id)
       order by (t.lot_category is not distinct from tpl.lot_category) desc,
                md5(_student_id::text || t.id::text)
       limit 1;
      if r.id is not null then
        tpl := r;
        scid := r.source_content_id;
        cand := (select c.id from public.lot_candidates c where c.lot_template_id = r.id limit 1);
        pick := coalesce(pick, '{}'::jsonb) || jsonb_build_object('rule', 'ready_instead_of_seed',
                  'source_content_id', scid, 'candidate_id', cand);
      end if;
    end;
  end if;
  select count(*) + 1 into n from public.tasks where student_id = _student_id and lot_date is not null;
  insert into public.tasks
    (student_id, title, description, code_sample, source_jd, difficulty,
     estimate_minutes, lot_category, lot_number, lot_date, source_content_id,
     status, visibility, due_date, is_ai_generated, created_by_type, source,
     xp_reward, sandbox_config_id, rubric_config_id, lot_candidate_id, lot_selection)
  values
    (_student_id, tpl.title, tpl.scenario, tpl.code_sample, tpl.source_jd, tpl.difficulty,
     tpl.estimate_minutes, tpl.lot_category, n, d, scid,
     'pending', 'private', (d + 1)::timestamptz - interval '1 second',
     tpl.origin = 'ai', 'system', 'daily_lot',
     tpl.xp_reward, tpl.sandbox_config_id, tpl.rubric_config_id, cand, pick)
  on conflict (student_id, lot_date) where lot_date is not null do nothing
  returning id into tid;
  if tid is null then
    select t.id, t.source_content_id into cur from public.tasks t
     where t.student_id = _student_id and t.lot_date = d limit 1;
    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'reason', 'another request created it first',
                              'source_content_id', cur.source_content_id,
                              'needs_writer', public.lot_needs_writer(cur.id));
  end if;
  return jsonb_build_object('ok', true, 'task_id', tid, 'created', true, 'source_content_id', scid,
                            'rule', pick->>'rule', 'needs_writer', tpl.origin = 'seed');
end $function$;

do $$
begin
  if position('ready_instead_of_seed' in pg_get_functiondef('public.create_lot_for'::regproc)) = 0 then
    raise exception '222 self-check: create_lot_for was not replaced';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
