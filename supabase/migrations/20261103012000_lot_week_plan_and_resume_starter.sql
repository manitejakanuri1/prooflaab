-- 130: the weekly Lot plan, a resume-based start, and Sunday rest (owner decisions, 22 Oct 2026).
--
-- WHY. Tested on staging 22 Oct 2026: a web-development student got a command-line Lot. The picker's
-- performance rules (strengthen / step up) only work from a student's earlier Lot scores, so a NEW
-- student - and at launch everyone is new - fell through to "broaden" (any skill at all) or the shared
-- rotation. Nothing looked at the skills on their resume or at the day of the week.
--
-- NOW.
-- 1. lot_day_kind(date): the owner's week. Mon / Wed / Fri technical, Tue business, Thu pitch,
--    Sat 'saturday' (new technology + career), Sun 'rest'.
-- 2. create_lot_for: Sunday makes no Lot (reason 'rest day'). Everything else is unchanged.
-- 3. lot_student_skills(student): the student's skills in the picker's own words (skill_vocab), read
--    from their latest resume skills + target role and their profile's preferred skills / interests.
-- 4. next_lot_pick(student, date):
--    technical day, fewer than 6 technical Lots given so far  -> 'starter': an unseen Easy/Medium
--        technical Lot on one of THEIR skills, the skill they have had least so far first.
--    technical day afterwards -> the existing rules, kept inside their own skills:
--        strengthen (< 70) and step up (>= 85) on technical Lots, broaden only to a skill of theirs.
--    business / pitch / saturday day -> an unseen Lot of that category (Saturday: business or pitch
--        until Lots of its own exist), the student's own college material first, as before.
--    If nothing fits, the old rotation (next_lot_source) still gives a Lot, so no student is left
--    without one. The one-argument next_lot_pick(student) keeps working and means "today".
-- 5. touch_streak: a Sunday off does not break a streak (Saturday -> Monday continues it).
-- College and company material is not reworded or re-targeted: it reaches students exactly as before.
--
-- Rollback: migration/130-rollback-lot-week-plan-and-resume-starter.sql
begin;

create or replace function public.lot_day_kind(_d date)
returns text
language sql immutable set search_path to 'public', 'pg_temp' as $function$
  select case extract(isodow from _d)::int
           when 1 then 'technical' when 3 then 'technical' when 5 then 'technical'
           when 2 then 'business'  when 4 then 'pitch'
           when 6 then 'saturday'  else 'rest' end;
$function$;

create or replace function public.lot_student_skills(_student_id uuid)
returns text[]
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select public.tag_skills(concat_ws(' ',
           (select array_to_string(rc.skills, ' ') || ' ' || coalesce(rc.target_role, '')
              from public.resume_claims rc where rc.student_id = _student_id
             order by rc.created_at desc limit 1),
           (select array_to_string(coalesce(p.preferred_skills, '{}') || coalesce(p.key_interests, '{}'), ' ')
                   || ' ' || coalesce(p.target_role, '')
              from public.student_profiles p where p.id = _student_id)));
$function$;

create or replace function public.next_lot_pick(_student_id uuid, _for_date date)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
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
     where t.lot_category = any(case when kind = 'saturday' then array['business', 'pitch'] else array[kind] end)
     order by p.own_college desc, md5(_student_id::text || p.candidate_id::text)
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
end $function$;

-- The one-argument form keeps its meaning for any other caller: today.
create or replace function public.next_lot_pick(_student_id uuid)
returns jsonb
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select public.next_lot_pick(_student_id, current_date);
$function$;

-- create_lot_for: unchanged except (a) Sunday is a rest day and (b) the pick knows the Lot's date.
do $$
declare
  f   constant regprocedure := 'public.create_lot_for(uuid,date)'::regprocedure;
  def text := pg_get_functiondef(f);
  old_pick constant text := '  pick := public.next_lot_pick(_student_id);';
  new_pick constant text := E'  if public.lot_day_kind(d) = ''rest'' then\n'
    || E'    return jsonb_build_object(''ok'', true, ''task_id'', null, ''created'', false,\n'
    || E'      ''reason'', ''rest day'', ''needs_writer'', false);\n'
    || E'  end if;\n'
    || E'  pick := public.next_lot_pick(_student_id, d);';
begin
  if (length(def) - length(replace(def, old_pick, ''))) / length(old_pick) <> 1 then
    raise exception '130: create_lot_for no longer has exactly one pick line';
  end if;
  execute replace(def, old_pick, new_pick);
end $$;

-- touch_streak: Saturday -> Monday continues a streak (Sunday is the rest day).
do $$
declare
  f   constant regprocedure := 'public.touch_streak(uuid)'::regprocedure;
  def text := pg_get_functiondef(f);
  old_rule constant text := 'public.student_streaks.last_active_on = current_date - 1';
  new_rule constant text := '(public.student_streaks.last_active_on = current_date - 1 or (extract(isodow from current_date) = 1 and public.student_streaks.last_active_on = current_date - 2))';
begin
  if (length(def) - length(replace(def, old_rule, ''))) / length(old_rule) <> 2 then
    raise exception '130: touch_streak no longer has the two "yesterday" checks';
  end if;
  execute replace(def, old_rule, new_rule);
end $$;

revoke all on function public.lot_day_kind(date) from public, anon;
revoke all on function public.lot_student_skills(uuid) from public, anon, authenticated;
revoke all on function public.next_lot_pick(uuid, date) from public, anon, authenticated;
revoke all on function public.next_lot_pick(uuid) from public, anon, authenticated;
grant execute on function public.lot_day_kind(date) to authenticated, service_role;
grant execute on function public.lot_student_skills(uuid) to service_role;
grant execute on function public.next_lot_pick(uuid, date) to service_role;
grant execute on function public.next_lot_pick(uuid) to service_role;

do $$
begin
  if public.lot_day_kind('2026-10-19') <> 'technical' or public.lot_day_kind('2026-10-20') <> 'business'
     or public.lot_day_kind('2026-10-21') <> 'technical' or public.lot_day_kind('2026-10-22') <> 'pitch'
     or public.lot_day_kind('2026-10-23') <> 'technical' or public.lot_day_kind('2026-10-24') <> 'saturday'
     or public.lot_day_kind('2026-10-25') <> 'rest' then
    raise exception '130: the week plan is wrong';
  end if;
  if position('rest day' in pg_get_functiondef('public.create_lot_for(uuid,date)'::regprocedure)) = 0
     or position('next_lot_pick(_student_id, d)' in pg_get_functiondef('public.create_lot_for(uuid,date)'::regprocedure)) = 0 then
    raise exception '130: create_lot_for was not updated';
  end if;
  if position('isodow from current_date) = 1' in pg_get_functiondef('public.touch_streak(uuid)'::regprocedure)) = 0 then
    raise exception '130: touch_streak was not updated';
  end if;
  if has_function_privilege('authenticated', 'public.next_lot_pick(uuid, date)', 'EXECUTE') then
    raise exception '130: students can call the picker directly';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
