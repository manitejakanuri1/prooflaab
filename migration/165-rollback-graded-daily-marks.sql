-- ROLLBACK for 165: back to the flat 20 points per finished Daily Lot (migration 163 bodies).
-- Roll the functions service back first (submit-sandbox-task / submit-written-task / voiceScore.ts call lot_state,
-- lot_submit, lot_voice_gate and fail_voice_attempt). daily_marks rows are dropped with the table.
begin;
CREATE OR REPLACE FUNCTION public.run_squad_week(_season_id uuid, _week integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  wk integer := coalesce(_week, greatest(1, public.season_week(_season_id) - 1));
  ranked integer := 0;
  played integer := 0;
  w_start timestamptz; w_end timestamptz; pts integer;
begin
  select b.starts_at, b.ends_at into w_start, w_end from public.season_week_bounds(_season_id, wk) b;
  -- 163 (MF-003, owner 28 Oct 2026): a student scores only for a Daily Lot finished in full - the task passed AND
  -- the voice explanation scored (tasks / task_assignments become 'completed' only then, migration 127). Anything
  -- less is 0 for that student only; nothing is taken from the squad or the other members.
  select sr.points into pts from public.squad_scoring_rules sr
   where sr.metric = 'lot_completed'
     and (sr.college_id = (select college_id from public.seasons where id = _season_id) or sr.college_id is null)
   order by sr.college_id nulls last limit 1;
  pts := coalesce(pts, 20);

  insert into public.student_weekly_scores
    (season_id, student_id, squad_id, week, points, breakdown)
  select _season_id, m.student_id, m.squad_id, wk, d.n * pts,
         case when d.n > 0 then jsonb_build_object('lot_completed', d.n) else '{}'::jsonb end
    from public.squad_members m
    join public.squads q on q.id = m.squad_id and q.season_id = _season_id
    cross join lateral (
      select ((select count(*) from public.tasks t
                where t.student_id = m.student_id and t.source = 'daily_lot' and t.status = 'completed'
                  and t.completed_at >= w_start and t.completed_at < w_end)
            + (select count(*) from public.task_assignments a join public.tasks t on t.id = a.task_id
                where a.student_id = m.student_id and t.source = 'daily_lot' and a.status = 'completed'
                  and t.student_id is distinct from m.student_id
                  and a.completed_at >= w_start and a.completed_at < w_end))::int as n
    ) d
   where m.left_at is null
  on conflict (season_id, student_id, week)
    do update set points = excluded.points, breakdown = excluded.breakdown;
  -- squad totals for the week
  insert into public.squad_weekly_scores
    (season_id, squad_id, week, points, active_members, total_members)
  select _season_id, q.id, wk,
         coalesce((select sum(s.points) from public.student_weekly_scores s
                    where s.season_id = _season_id and s.squad_id = q.id and s.week = wk), 0),
         coalesce((select count(*) from public.student_weekly_scores s
                    where s.season_id = _season_id and s.squad_id = q.id and s.week = wk and s.points > 0), 0),
         coalesce((select count(*) from public.squad_members m
                    where m.squad_id = q.id and m.left_at is null), 0)
    from public.squads q
   where q.season_id = _season_id
  on conflict (season_id, squad_id, week)
    do update set points = excluded.points,
                  active_members = excluded.active_members,
                  total_members = excluded.total_members,
                  computed_at = now();
  with r as (
    select squad_id, rank() over (order by points desc, squad_id) as pos
      from public.squad_weekly_scores
     where season_id = _season_id and week = wk
  )
  update public.squad_weekly_scores w set rank = r.pos
    from r where w.squad_id = r.squad_id and w.season_id = _season_id and w.week = wk;
  -- season points are every week so far, not just this one
  update public.squads q
     set previous_rank = q.rank,
         points = coalesce((select sum(points) from public.squad_weekly_scores
                             where season_id = _season_id and squad_id = q.id), 0)
   where q.season_id = _season_id;
  select count(*) into ranked from public.squads where season_id = _season_id;
  played := public.settle_round(_season_id, wk);
  perform public.recount_season(_season_id);
  perform public.write_audit('SQUAD_WEEK_SCORED', 'squad_weekly_scores', _season_id,
    null, jsonb_build_object('week', wk, 'squads', ranked, 'matches_settled', played),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'week', wk, 'squads_scored', ranked,
                            'matches_settled', played);
end $function$;

CREATE OR REPLACE FUNCTION public.tpo_scoring_rules()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'metric', d.metric, 'label', d.label, 'description', d.description,
           'default_points', d.points,
           'points', coalesce(o.points, d.points),
           'customized', o.points is not null)
         order by d.metric), '[]'::jsonb)
    from public.squad_scoring_rules d
    left join public.squad_scoring_rules o
      on o.metric = d.metric and o.college_id = public.my_college_id()
   -- 163 (MF-003): only a Daily Lot finished in full scores now; the other rows no longer count.
   where d.college_id is null and d.metric = 'lot_completed';
$function$;

drop function if exists public.squad_marks_week(uuid);
drop function if exists public.my_marks_week();
drop function if exists public.submit_my_lot(uuid);
drop function if exists public.my_lot_state(uuid);
drop function if exists public.marks_week_window(uuid);
drop function if exists public.fail_voice_attempt(uuid, uuid, text, text);
drop function if exists public.lot_voice_gate(uuid);
drop function if exists public.lot_submit(uuid, uuid);
drop function if exists public.lot_state(uuid, uuid);
drop function if exists public.lot_marks(uuid, timestamptz, timestamptz);
drop table if exists public.daily_marks;
commit;
notify pgrst, 'reload schema';
