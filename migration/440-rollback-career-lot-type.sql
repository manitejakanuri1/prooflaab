-- Rollback of 440: Career Lots go back to seed cards, Saturday picks business/pitch again, 'career' is no longer allowed.
-- Tasks already handed out as Career Lots keep their text and become 'business' (the written kind closest to it).
begin;
update public.lot_templates t
   set title = b.old_title, scenario = b.old_scenario, difficulty = b.old_difficulty, source_jd = b.old_source_jd,
       lot_category = b.old_lot_category, origin = b.old_origin
  from public.bank_career_440 b where t.id = b.template_id;
update public.lot_templates set lot_category = 'business' where lot_category = 'career';
update public.tasks set lot_category = 'business' where lot_category = 'career';
alter table public.lot_templates drop constraint lot_templates_lot_category_check;
alter table public.lot_templates add constraint lot_templates_lot_category_check
  check (lot_category = any (array['technical', 'business', 'pitch']));
alter table public.tasks drop constraint tasks_lot_category_check;
alter table public.tasks add constraint tasks_lot_category_check
  check (lot_category is null or lot_category = any (array['technical', 'business', 'pitch']));

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
  -- 236 (owner 12 Nov 2026): pitch day first asks about the student's own resume - each project, then each
  -- certification, once. Students without them (or who have done them all) get a normal pitch Lot below.
  if kind = 'pitch' then
    declare r_item text; r_kind text;
    begin
      select x.item, x.k into r_item, r_kind
        from (select left(btrim(p ->> 'title'), 80) as item, 'project' as k, 1 as o, n
                from (select projects from public.resume_claims where student_id = _student_id
                       order by created_at desc limit 1) rc,
                     jsonb_array_elements(case when jsonb_typeof(rc.projects) = 'array' then rc.projects else '[]'::jsonb end)
                       with ordinality as e(p, n)
              union all
              select left(btrim(c), 80), 'certification', 2, n
                from (select certifications from public.resume_claims where student_id = _student_id
                       order by created_at desc limit 1) rc,
                     unnest(coalesce(rc.certifications, '{}')) with ordinality as e(c, n)) x
       where coalesce(x.item, '') <> ''
         and not exists (select 1 from public.tasks k where k.student_id = _student_id
                          and k.lot_selection ->> 'resume_item' = x.item)
       order by x.o, x.n
       limit 1;
      if r_item is not null then
        select c.id, c.source_content_id into c_id, c_sc
          from public.lot_templates t join public.lot_candidates c on c.lot_template_id = t.id
         where t.source_jd = 'Written by ProofLab (resume ' || r_kind || ')' limit 1;
        if c_id is not null then
          return jsonb_build_object('version', 'lot-select-3', 'rule', 'resume_' || r_kind, 'candidate_id', c_id,
                   'source_content_id', c_sc, 'focus_skill', null, 'evidence', null, 'resume_item', r_item,
                   'why', 'Thursday is pitch day. Today you explain something from your own resume.');
        end if;
      end if;
    end;
  end if;
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

drop table public.bank_career_440;
notify pgrst, 'reload schema';
commit;
