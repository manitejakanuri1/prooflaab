-- ROLLBACK for 90: restore next_lot_pick exactly as migration 88 defined it.
create or replace function public.next_lot_pick(_student_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare
  college uuid;
  ev      record;
  ev_json jsonb;
  c_id    uuid;  c_sc uuid;  c_sk text[];  c_diff text;
  rule    text;
  why     text;
  focus   text;
  scid    uuid;
  drank   int;
  has_ev  boolean;
  ev10    jsonb;   -- evidence is read ONCE per student (15 ms each on staging) and reused below
  ev3     jsonb;
begin
  select p.college_id into college from public.student_profiles p where p.id = _student_id;
  ev10 := (select jsonb_agg(to_jsonb(e)) from public.lot_skill_evidence(_student_id, 10) e);
  has_ev := ev10 is not null;

  -- Rule 1 STRENGTHEN: weakest recent skill (avg < 70) -> an unseen candidate on that skill, nearest difficulty.
  for ev in select * from jsonb_to_recordset(coalesce(ev10, '[]')) as e(skill text, lots int, avg_score int, tests_passed int, tests_total int, attempts int, failed int, needs_review int, voice_avg int, match_avg int, weakest_criterion text, last_difficulty text, last_at timestamptz, last_title text)
             where e.avg_score < 70 order by e.avg_score asc, e.last_at desc loop
    drank := case lower(ev.last_difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end;
    select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
      from public.lot_candidate_pool(_student_id, college) p where ev.skill = any(p.skills)
     order by abs(case lower(p.difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end - drank),
              p.own_college desc, md5(_student_id::text || p.candidate_id::text)
     limit 1;
    if c_id is not null then
      rule := 'strengthen'; focus := ev.skill; ev_json := to_jsonb(ev);
      why := format('Your last %s %s Lot%s averaged %s/100', ev.lots, ev.skill, case when ev.lots = 1 then '' else 's' end, ev.avg_score)
          || case when ev.tests_total > 0 then format(' (%s of %s tests passed)', ev.tests_passed, ev.tests_total) else '' end
          || case when ev.weakest_criterion is not null then format('; weakest rubric part: %s', ev.weakest_criterion) else '' end
          || case when ev.voice_avg is not null then format('; your spoken explanation scored %s/100', ev.voice_avg) else '' end
          || format('. Today''s Lot practises %s again.', ev.skill);
      exit;
    end if;
  end loop;

  -- Rule 2 STEP UP: most recent strong skill (avg >= 85) -> same skill, harder when available.
  if c_id is null and has_ev then
    ev3 := (select jsonb_agg(to_jsonb(e)) from public.lot_skill_evidence(_student_id, 3) e);
    for ev in select * from jsonb_to_recordset(coalesce(ev3, '[]')) as e(skill text, lots int, avg_score int, tests_passed int, tests_total int, attempts int, failed int, needs_review int, voice_avg int, match_avg int, weakest_criterion text, last_difficulty text, last_at timestamptz, last_title text)
               where e.avg_score >= 85 order by e.last_at desc limit 1 loop
      drank := case lower(ev.last_difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end;
      select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
        from public.lot_candidate_pool(_student_id, college) p where ev.skill = any(p.skills)
       order by (case lower(p.difficulty) when 'medium' then 2 when 'hard' then 3 else 1 end > drank) desc,
                p.own_college desc, md5(_student_id::text || p.candidate_id::text)
       limit 1;
      if c_id is not null then
        rule := 'step_up'; focus := ev.skill; ev_json := to_jsonb(ev);
        why := format('Your last %s %s Lot%s averaged %s/100', ev.lots, ev.skill, case when ev.lots = 1 then '' else 's' end, ev.avg_score)
            || case when ev.tests_total > 0 then format(' (%s of %s tests passed)', ev.tests_passed, ev.tests_total) else '' end
            || format('. Today''s Lot is another %s task%s.', ev.skill,
                      case when lower(coalesce(c_diff, '')) <> lower(coalesce(ev.last_difficulty, '')) then ' at ' || c_diff || ' difficulty' else '' end);
      end if;
    end loop;
  end if;

  -- Rule 3 BROADEN: a skill with no Daily-Lot evidence yet.
  if c_id is null and has_ev then
    select p.candidate_id, p.source_content_id, p.skills, p.difficulty into c_id, c_sc, c_sk, c_diff
      from public.lot_candidate_pool(_student_id, college) p
     where cardinality(p.skills) > 0
       and not (p.skills && coalesce((select array_agg(e->>'skill') from jsonb_array_elements(ev10) e), '{}'))
     order by p.own_college desc, md5(_student_id::text || p.candidate_id::text)
     limit 1;
    if c_id is not null then
      rule := 'broaden'; focus := c_sk[1];
      why := format('Your recent Lots have not covered %s yet, so today''s Lot does.', array_to_string(c_sk, ', '));
    end if;
  end if;

  if c_id is not null then
    return jsonb_build_object('version', 'lot-select-1', 'rule', rule, 'candidate_id', c_id,
             'source_content_id', c_sc, 'focus_skill', focus, 'why', why, 'evidence', ev_json);
  end if;

  -- Rule 4 ROTATION: no evidence yet, or nothing unseen matches: the existing pool rotation (unchanged).
  scid := public.next_lot_source(_student_id);
  if scid is null then return null; end if;
  return jsonb_build_object('version', 'lot-select-1',
           'rule', case when has_ev then 'rotation' else 'no_evidence_yet' end,
           'candidate_id', (select c.id from public.lot_candidates c where c.source_content_id = scid
                             order by (c.status = 'active') desc, c.created_at limit 1),
           'source_content_id', scid, 'focus_skill', null,
           'why', case when has_ev
                       then 'No unused Lot matches your recent results yet, so this one comes from the shared pool.'
                       else 'You have not submitted a Lot yet, so this one comes from the shared pool. From your first submission on, Lots follow your results.' end,
           'evidence', null);
end $function$;

revoke all on function public.next_lot_pick(uuid) from public, anon, authenticated;
grant execute on function public.next_lot_pick(uuid) to service_role;
do $$ begin
  if position('no_tagged_evidence' in (select prosrc from pg_proc where oid = 'public.next_lot_pick(uuid)'::regprocedure)) > 0 then
    raise exception 'rollback 90 failed'; end if;
end $$;
