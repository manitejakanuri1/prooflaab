-- Rollback of 200: bank questions stop becoming Lots and new ones wait as drafts again.
-- Lots already handed out keep their own copy. The bank pages are hidden (not deleted, so tasks that point at
-- them keep working); roadmap_material and the admin-submitted pages stay (they hold the admin's own text).
-- next_lot_pick goes back to "first 6 technical Lots from resume skills" (the definition before 200).
begin;
drop trigger if exists question_bank_to_page on public.question_bank;
drop function if exists public.question_bank_to_page();
update public.source_content set hidden_at = coalesce(hidden_at, now()) where bank_question_id is not null;
alter table public.question_bank alter column status set default 'draft';
drop function if exists public.admin_add_material(text, text, text);
drop function if exists public.roadmap_material_for(text, integer);
drop function if exists public.question_bank_pending(integer, timestamptz);
create or replace function public.question_bank_pending(_limit integer default 3)
returns table (id uuid)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select sc.id
    from public.source_content sc
   where sc.hidden_at is null
     and length(coalesce(sc.markdown, '')) >= 300
     and not exists (select 1 from public.question_bank_attempts a where a.source_content_id = sc.id)
   order by sc.fetched_at desc
   limit greatest(1, least(coalesce(_limit, 3), 10));
$fn$;
revoke all on function public.question_bank_pending(integer) from public, anon, authenticated;
grant execute on function public.question_bank_pending(integer) to service_role;
CREATE OR REPLACE FUNCTION public.next_lot_pick(_student_id uuid, _for_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $fn$
declare
  college uuid;
  kind    text := public.lot_day_kind(coalesce(_for_date, current_date));
  mine    text[];
  given   int;
  ev      record;
  ev_json jsonb;
  c_id    uuid;  c_sc uuid;  c_sk text[];  c_diff text;
  rule    text;  why text;   focus text;   drank int;
  ev10    jsonb; ev3 jsonb;
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
    select count(*) into given from public.tasks t
     where t.student_id = _student_id and t.lot_date is not null and t.lot_category = 'technical';
    -- STARTER: the first 6 technical Lots come from the student's own skills, Easy or Medium.
    if given < 6 and cardinality(mine) > 0 then
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
                 'why', format('Your first Lots come from the skills on your resume. Today: %s (%s of 6).', focus, given + 1));
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
       where t.lot_category = 'technical' and ev.skill = any(p.skills)
       order by abs(case lower(p.difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end - drank),
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
         where t.lot_category = 'technical' and ev.skill = any(p.skills)
         order by (case lower(p.difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end > drank) desc,
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
       where t.lot_category = 'technical' and p.skills && mine
       order by (p.skills && coalesce((select array_agg(e->>'skill') from jsonb_array_elements(ev10) e), '{}')) asc,
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
end $fn$;
commit;
