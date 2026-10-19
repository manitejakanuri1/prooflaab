-- 125: the season report is a report card - verdict, place, growth and skills.
--
-- The student's Season tab showed points, best week, weeks active and the weekly curve, but not
-- how good the season was, where the student stands, whether they grew, or which skills. Owner
-- request, 19 Oct 2026. my_season_report now also returns:
--   rank {place, of, points}       place among every student scored this season
--   growth {first_avg, last_avg, change_pct}   first three weeks vs last three (4+ weeks only)
--   verdict {level, text}          strong: top fifth and active 9+ weeks; steady: 6+ weeks; else quiet
--   skill_list {strong, needs_work}   proven / assessed >= 60 skills plus the onboarding score
--                                     card's verified skills; needs_improvement plus its gaps
-- and finds the season through the student's squad when they have no points yet (before, such a
-- student read "No season points for you yet" while their squad's season was on screen).
-- Every existing key stays.
begin;

CREATE OR REPLACE FUNCTION public.my_season_report(_season_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  me  uuid := (select auth.uid());
  sid uuid;
  s   record;
  place int; field int; my_points int;
  first_avg numeric; last_avg numeric; active_weeks int; total_weeks int;
  gap jsonb;
  verdict text; verdict_text text;
begin
  if me is null then raise exception 'not signed in'; end if;

  select coalesce(_season_id,
           (select w.season_id from public.student_weekly_scores w
             where w.student_id = me order by w.week desc limit 1),
           -- 125: no points yet, but the student's squad is in a season.
           (select q.season_id from public.squad_members m join public.squads q on q.id = m.squad_id
             where m.student_id = me and m.left_at is null and q.season_id is not null limit 1))
    into sid;

  -- 125: place among every student scored this season, growth from the first three
  -- active weeks to the last three, and the skills behind the season.
  with t as (select w.student_id, sum(w.points) as p from public.student_weekly_scores w
              where w.season_id = sid group by w.student_id),
       mine as (select coalesce((select p from t where t.student_id = me), 0) as p)
  select 1 + count(*) filter (where t.p > mine.p),
         count(*) + case when exists (select 1 from t where t.student_id = me) then 0 else 1 end,
         mine.p
    into place, field, my_points
    from mine left join t on true
   group by mine.p;

  select round(avg(w.points) filter (where w.rn_asc <= 3)), round(avg(w.points) filter (where w.rn_desc <= 3)),
         count(*) filter (where w.points > 0), count(*)
    into first_avg, last_avg, active_weeks, total_weeks
    from (select w.points,
                 row_number() over (order by w.week) as rn_asc,
                 row_number() over (order by w.week desc) as rn_desc
            from public.student_weekly_scores w
           where w.student_id = me and w.season_id = sid) w;

  select c.skill_gap into gap from public.resume_scorecards c
   where c.student_id = me and c.skill_gap is not null
   order by c.created_at desc limit 1;
  if sid is null then
    return jsonb_build_object('has_season', false);
  end if;

  select * into s from public.seasons where id = sid;

  -- Verdict: strong = top fifth and active 9+ of 12 weeks; steady = active 6+ weeks; else quiet.
  verdict := case when coalesce(active_weeks, 0) >= 9 and place <= greatest(1, ceil(field * 0.2)) then 'strong'
                  when coalesce(active_weeks, 0) >= 6 then 'steady'
                  else 'quiet' end;
  verdict_text := case verdict
      when 'strong' then 'Strong season: #' || place || ' of ' || field || ' students, active ' || active_weeks || ' of ' || total_weeks || ' weeks.'
      when 'steady' then 'Steady season: #' || place || ' of ' || field || ' students, active ' || active_weeks || ' of ' || total_weeks || ' weeks.'
      else 'Quiet season: active ' || coalesce(active_weeks, 0) || ' of ' || coalesce(nullif(total_weeks, 0), s.planned_weeks)
           || ' weeks. Showing up most weeks matters more than any one big week.' end;

  return jsonb_build_object(
    'has_season', true,
    'season', jsonb_build_object('name', s.name, 'weeks', s.planned_weeks,
                                 'status', s.status, 'ends_on', s.ends_on),

    -- The curve. A season is a shape, not a total.
    'weekly', (select coalesce(jsonb_agg(jsonb_build_object(
                 'week', w.week, 'points', w.points, 'breakdown', w.breakdown)
                 order by w.week), '[]'::jsonb)
                 from public.student_weekly_scores w
                where w.student_id = me and w.season_id = sid),

    'totals', (select jsonb_build_object(
                 'points', coalesce(sum(w.points), 0),
                 'best_week', coalesce(max(w.points), 0),
                 'weeks_active', count(*) filter (where w.points > 0),
                 'weeks_total', count(*))
                 from public.student_weekly_scores w
                where w.student_id = me and w.season_id = sid),

    -- Where the points came from, so "record more explanations" is a fact
    -- rather than advice.
    'by_activity', (select coalesce(jsonb_object_agg(t.k, t.n), '{}'::jsonb) from (
        select b.k, sum((b.v->>'points')::int) as n
          from public.student_weekly_scores w,
               lateral jsonb_each(w.breakdown) as b(k, v)
         where w.student_id = me and w.season_id = sid
         group by b.k) t),

    'squad', (select jsonb_build_object('name', q.name, 'rank', q.rank,
                'points', q.points, 'record', q.wins||'-'||q.draws||'-'||q.losses,
                'my_contribution', m.contribution)
                from public.squad_members m
                join public.squads q on q.id = m.squad_id
               where m.student_id = me and m.left_at is null limit 1),

    'podium', jsonb_build_object(
       'champion',  (select name from public.squads where id = s.champion_squad_id),
       'runner_up', (select name from public.squads where id = s.runner_up_squad_id),
       'third',     (select name from public.squads where id = s.third_squad_id)),

    'skills', jsonb_build_object(
      'proven',   (select count(*) from public.student_skills k
                    where k.student_id = me and k.status = 'proven'),
      'assessed', (select count(*) from public.student_skills k
                    where k.student_id = me and k.status = 'assessed'),
      'weak',     (select coalesce(jsonb_agg(k.skill order by k.skill), '[]'::jsonb)
                     from public.student_skills k
                    where k.student_id = me and k.status = 'needs_improvement')),

    'ladder', jsonb_build_object(
      'cleared', (select count(*) from public.student_levels l
                   where l.student_id = me and l.status in ('cleared','mastered')),
      'started', (select count(*) from public.student_levels l
                   where l.student_id = me and l.status = 'opened')),

    'rank', jsonb_build_object('place', place, 'of', field, 'points', my_points),

    'growth', case when coalesce(total_weeks, 0) >= 4 then jsonb_build_object(
        'first_avg', first_avg, 'last_avg', last_avg,
        'change_pct', case when coalesce(first_avg, 0) > 0
                           then round((last_avg - first_avg) * 100.0 / first_avg) end) end,

    'verdict', jsonb_build_object('level', verdict, 'text', verdict_text),

    -- Skills by name: what this student has shown, and what the onboarding test said is missing.
    'skill_list', jsonb_build_object(
      'strong', (select coalesce(jsonb_agg(distinct x.skill), '[]'::jsonb) from (
          select k.skill from public.student_skills k
           where k.student_id = me
             and (k.status = 'proven' or (k.status = 'assessed' and coalesce(k.assessed_score, 0) >= 60))
          union
          select v from jsonb_array_elements_text(case when jsonb_typeof(gap->'verified') = 'array'
                                                       then gap->'verified' else '[]'::jsonb end) v) x),
      'needs_work', (select coalesce(jsonb_agg(distinct x.skill), '[]'::jsonb) from (
          select k.skill from public.student_skills k
           where k.student_id = me and k.status = 'needs_improvement'
          union
          select v from jsonb_array_elements_text(case when jsonb_typeof(gap->'missing') = 'array'
                                                       then gap->'missing' else '[]'::jsonb end) v
          union
          select v from jsonb_array_elements_text(case when jsonb_typeof(gap->'needs_improvement') = 'array'
                                                       then gap->'needs_improvement' else '[]'::jsonb end) v) x)),

    -- What to do next, from this student's own gaps rather than a generic
    -- list, cheapest win first.
    'next', (select coalesce(jsonb_agg(x.line order by x.ord), '[]'::jsonb) from (
        select 1 as ord, 'Finish the ' || count(*) || ' topic' ||
               case when count(*) = 1 then '' else 's' end || ' you started and left.' as line
          from public.student_levels l
         where l.student_id = me and l.status = 'opened' having count(*) > 0
        union all
        select 2, 'Retake ' || string_agg(k.skill, ', ') || ' — the assessment came back short.'
          from public.student_skills k
         where k.student_id = me and k.status = 'needs_improvement' having count(*) > 0
        union all
        select 3, 'Record more explanations. Talking through your work is the ' ||
                  'cheapest evidence you can add.'
         where (select count(*) from public.voice_explanations v where v.student_id = me) < 5
        union all
        select 4, 'You were active ' ||
               (select count(*) filter (where w.points > 0) from public.student_weekly_scores w
                 where w.student_id = me and w.season_id = sid) ||
               ' of ' ||
               (select count(*) from public.student_weekly_scores w
                 where w.student_id = me and w.season_id = sid) ||
               ' weeks. Consistency counts more than any single week.'
         where (select count(*) filter (where w.points > 0) from public.student_weekly_scores w
                 where w.student_id = me and w.season_id = sid)
             < (select count(*) from public.student_weekly_scores w
                 where w.student_id = me and w.season_id = sid)) x)
  );
end $function$;

-- Self-check: a student with season points gets a verdict, a place and a skills block.
do $$
declare stu uuid; r jsonb;
begin
  select w.student_id into stu from public.student_weekly_scores w group by w.student_id
   having count(*) >= 4 limit 1;
  if stu is null then raise notice '125 self-check skipped: no student with 4+ scored weeks'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
  r := public.my_season_report();
  perform set_config('request.jwt.claims', '', true);
  if not (r ? 'verdict' and r ? 'rank' and r ? 'skill_list' and r ? 'growth')
     or (r->'rank'->>'place')::int < 1 or (r->'rank'->>'place')::int > (r->'rank'->>'of')::int then
    raise exception '125 self-check: unexpected report %', left(r::text, 300);
  end if;
  raise notice '125 self-check passed: %', r->'verdict'->>'text';
end $$;

commit;
notify pgrst, 'reload schema';
