-- Rollback for 236: the picker and Lot maker as before; resume templates retired (given Lots stay).
begin;
CREATE OR REPLACE FUNCTION public.next_lot_pick(_student_id uuid, _for_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
declare
  college uuid;
  kind    text := public.lot_day_kind(coalesce(_for_date, current_date));
  mine    text[];
  ev      record;
  ev_json jsonb;
  c_id    uuid;  c_sc uuid;  c_sk text[];  c_diff text;
  rule    text;  why text;   focus text;   drank int;
  ev10    jsonb; ev3 jsonb;
  first_d date;
begin
  select p.college_id into college from public.student_profiles p where p.id = _student_id;
  if kind in ('business', 'pitch', 'saturday') then
    select p.candidate_id, p.source_content_id, p.skills into c_id, c_sc, c_sk
      from public.lot_candidate_pool(_student_id, college) p
      join public.lot_candidates c on c.id = p.candidate_id
      join public.lot_templates t on t.id = c.lot_template_id
     where t.lot_category = any(case when kind = 'saturday' then array['business', 'pitch']
                                 when kind = 'pitch' then array['pitch', 'business'] else array[kind] end)
     order by (t.lot_category = kind) desc, p.own_college desc, md5(_student_id::text || p.candidate_id::text)
     limit 1;
    if c_id is not null then
      return jsonb_build_object('version', 'lot-select-3', 'rule', 'day_' || kind, 'candidate_id', c_id,
               'source_content_id', c_sc, 'focus_skill', c_sk[1], 'evidence', null,
               'why', case kind when 'business' then 'Tuesday is business day.'
                                when 'pitch' then 'Thursday is pitch day.'
                                else 'Saturday is career day.' end);
    end if;
  end if;
  if kind = 'technical' then
    mine := public.lot_student_skills(_student_id);
    select min(t.lot_date) into first_d from public.tasks t
     where t.student_id = _student_id and t.lot_date is not null;
    -- STARTER (200, owner 31 Oct 2026): the whole first week of Daily Lots comes from the student's own resume
    -- skills, Easy or Medium. From week 2 the performance rules below pick, bank questions first.
    if (first_d is null or coalesce(_for_date, current_date) - first_d < 7) and cardinality(mine) > 0 then
      select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
        from public.lot_candidate_pool(_student_id, college) p
        join public.lot_candidates c on c.id = p.candidate_id
        join public.lot_templates t on t.id = c.lot_template_id
       where t.lot_category = 'technical' and p.skills && mine
         and lower(coalesce(p.difficulty, 'easy')) in ('easy', 'medium')
       order by (select count(*) from public.tasks k join public.lot_candidates kc on kc.id = k.lot_candidate_id
                  where k.student_id = _student_id and kc.skills && p.skills) asc,
                lower(coalesce(p.difficulty, 'easy')) = 'easy' desc,
                p.own_college desc, md5(_student_id::text || p.candidate_id::text)
       limit 1;
      if c_id is not null then
        focus := (select s from unnest(c_sk) s where s = any(mine) limit 1);
        return jsonb_build_object('version', 'lot-select-3', 'rule', 'starter', 'candidate_id', c_id,
                 'source_content_id', c_sc, 'focus_skill', focus, 'evidence', null,
                 'why', format('Your first week of Lots comes from the skills on your resume. Today: %s.', focus));
      end if;
    end if;
    -- AFTER THE START: the existing performance rules, on technical Lots inside the student's skills.
    ev10 := (select jsonb_agg(to_jsonb(e)) from public.lot_skill_evidence(_student_id, 10) e);
    mine := coalesce(mine, '{}') || coalesce((select array_agg(e->>'skill') from jsonb_array_elements(ev10) e), '{}');
    for ev in select * from jsonb_to_recordset(coalesce(ev10, '[]')) as e(skill text, lots int, avg_score int, tests_passed int, tests_total int, attempts int, failed int, needs_review int, voice_avg int, match_avg int, weakest_criterion text, last_difficulty text, last_at timestamptz, last_title text)
               where e.avg_score < 70 order by e.avg_score asc, e.last_at desc loop
      drank := case lower(ev.last_difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end;
      select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
        from public.lot_candidate_pool(_student_id, college) p
        join public.lot_candidates c on c.id = p.candidate_id
        join public.lot_templates t on t.id = c.lot_template_id
        join public.source_content bs on bs.id = p.source_content_id
       where t.lot_category = 'technical' and ev.skill = any(p.skills)
       order by (bs.bank_question_id is not null) desc, abs(case lower(p.difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end - drank),
                p.own_college desc, md5(_student_id::text || p.candidate_id::text)
       limit 1;
      if c_id is not null then
        rule := 'strengthen'; focus := ev.skill; ev_json := to_jsonb(ev);
        why := format('Your last %s %s Lot%s averaged %s/100. Today''s Lot practises %s again.',
                      ev.lots, ev.skill, case when ev.lots = 1 then '' else 's' end, ev.avg_score, ev.skill);
        exit;
      end if;
    end loop;
    if c_id is null and ev10 is not null then
      ev3 := (select jsonb_agg(to_jsonb(e)) from public.lot_skill_evidence(_student_id, 3) e);
      for ev in select * from jsonb_to_recordset(coalesce(ev3, '[]')) as e(skill text, lots int, avg_score int, tests_passed int, tests_total int, attempts int, failed int, needs_review int, voice_avg int, match_avg int, weakest_criterion text, last_difficulty text, last_at timestamptz, last_title text)
                 where e.avg_score >= 85 order by e.last_at desc limit 1 loop
        drank := case lower(ev.last_difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end;
        select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
          from public.lot_candidate_pool(_student_id, college) p
          join public.lot_candidates c on c.id = p.candidate_id
          join public.lot_templates t on t.id = c.lot_template_id
          join public.source_content bs on bs.id = p.source_content_id
         where t.lot_category = 'technical' and ev.skill = any(p.skills)
         order by (bs.bank_question_id is not null) desc, (case lower(p.difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end > drank) desc,
                  p.own_college desc, md5(_student_id::text || p.candidate_id::text)
         limit 1;
        if c_id is not null then
          rule := 'step_up'; focus := ev.skill; ev_json := to_jsonb(ev);
          why := format('Your last %s %s Lot%s averaged %s/100. Today''s Lot is a step up.',
                        ev.lots, ev.skill, case when ev.lots = 1 then '' else 's' end, ev.avg_score);
        end if;
      end loop;
    end if;
    -- BROADEN, but only to a skill that is the student's own and not practised recently.
    if c_id is null and cardinality(mine) > 0 then
      select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
        from public.lot_candidate_pool(_student_id, college) p
        join public.lot_candidates c on c.id = p.candidate_id
        join public.lot_templates t on t.id = c.lot_template_id
        join public.source_content bs on bs.id = p.source_content_id
       where t.lot_category = 'technical' and p.skills && mine
       order by (bs.bank_question_id is not null) desc, (p.skills && coalesce((select array_agg(e->>'skill') from jsonb_array_elements(ev10) e), '{}')) asc,
                p.own_college desc, md5(_student_id::text || p.candidate_id::text)
       limit 1;
      if c_id is not null then
        rule := 'broaden'; focus := (select s from unnest(c_sk) s where s = any(mine) limit 1);
        why := format('Today''s Lot is on %s, one of your own skills.', focus);
      end if;
    end if;
    if c_id is not null then
      return jsonb_build_object('version', 'lot-select-3', 'rule', rule, 'candidate_id', c_id,
               'source_content_id', c_sc, 'focus_skill', focus, 'why', why, 'evidence', ev_json);
    end if;
  end if;
  -- Nothing fits the day or the student's skills: the old rotation, so no student is left without a Lot.
  c_sc := public.next_lot_source(_student_id);
  if c_sc is null then return null; end if;
  return jsonb_build_object('version', 'lot-select-3', 'rule', 'rotation',
           'candidate_id', (select c.id from public.lot_candidates c where c.source_content_id = c_sc
                             order by (c.status = 'active') desc, c.created_at limit 1),
           'source_content_id', c_sc, 'focus_skill', null, 'evidence', null,
           'why', 'No unused Lot matches today''s plan and your skills yet, so this one comes from the shared pool.');
end $function$;

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
         -- 227: a written template whose text asks for a program would give an answer box for code.
         and not (t.sandbox_config_id is null and public.lot_text_asks_for_code(t.title, t.scenario, t.code_sample))
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
commit;
