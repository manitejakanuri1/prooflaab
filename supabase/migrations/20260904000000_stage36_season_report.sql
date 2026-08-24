-- ============================================================================
-- Stage 36 — the per-student season report. Step 18's other half.
--
-- The podium has been published since stage 23; what was missing was the half
-- the student cares about. Derived, not stored: every figure already lives in
-- student_weekly_scores, student_skills and the ladder, and a saved copy is a
-- second version that drifts from the first.
--
-- One shape to note: breakdown is nested — {"lot_submitted": {"count": 1,
-- "points": 10}} — not flat. Summing the value as an integer fails.
-- ============================================================================

create or replace function public.my_season_report(_season_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  me  uuid := (select auth.uid());
  sid uuid;
  s   record;
begin
  if me is null then raise exception 'not signed in'; end if;

  select coalesce(_season_id,
           (select w.season_id from public.student_weekly_scores w
             where w.student_id = me order by w.week desc limit 1))
    into sid;
  if sid is null then
    return jsonb_build_object('has_season', false);
  end if;

  select * into s from public.seasons where id = sid;

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
end $fn$;

revoke all on function public.my_season_report(uuid) from public, anon;
grant execute on function public.my_season_report(uuid) to authenticated;
