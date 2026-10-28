-- ROLLBACK for 163: activity-based scoring and played 0-0 again. On TEST re-apply the overlay afterwards.
-- Matches saved as 'no_activity' become played 0-0 again before the old status rule returns.
-- winner_squad / decided_by and the lot_completed rule row stay (unused by the old code).
begin;

update public.squad_matches set status = 'played' where status = 'no_activity';
alter table public.squad_matches drop constraint squad_matches_status_check;
alter table public.squad_matches add constraint squad_matches_status_check
  check (status = any (array['scheduled', 'played', 'cancelled']));

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
begin
  -- individual scores for the week
  insert into public.student_weekly_scores
    (season_id, student_id, squad_id, week, points, breakdown)
  select _season_id, m.student_id, m.squad_id, wk,
         coalesce(sum(r.points), 0),
         coalesce(jsonb_object_agg(r.metric, r.n) filter (where r.metric is not null), '{}'::jsonb)
    from public.squad_members m
    join public.squads q on q.id = m.squad_id and q.season_id = _season_id
    left join lateral (
      select sr.metric, sr.points * count(*) as points, count(*) as n
        from public.student_activity_events e
        join lateral (
          -- college_id already lives on the event row, so this needs no join
          -- back to student_profiles. A college-specific row wins over the
          -- platform default for the same metric.
          select * from public.squad_scoring_rules sr2
           where sr2.metric = e.event_type
             and (sr2.college_id = e.college_id or sr2.college_id is null)
           order by sr2.college_id nulls last
           limit 1
        ) sr on true
       where e.student_id = m.student_id
         and e.occurred_at >= public.season_week_start(_season_id, wk)
         and e.occurred_at <  public.season_week_start(_season_id, wk) + interval '7 days'
       group by sr.metric, sr.points
      union all
      -- Active day: once per calendar day (India time) with any activity, however
      -- much was done that day. Its rule existed since stage 16, but 'active_day'
      -- is not an event type, so the per-event join above could never match it.
      select ad.metric, ad.points * d.n, d.n
        from (select count(distinct (e.occurred_at at time zone 'Asia/Kolkata')::date)::int as n
                from public.student_activity_events e
               where e.student_id = m.student_id
                 and e.occurred_at >= public.season_week_start(_season_id, wk)
                 and e.occurred_at <  public.season_week_start(_season_id, wk) + interval '7 days') d
        join lateral (
          select sr3.metric, sr3.points from public.squad_scoring_rules sr3
           where sr3.metric = 'active_day'
             and (sr3.college_id = q.college_id or sr3.college_id is null)
           order by sr3.college_id nulls last
           limit 1
        ) ad on true
       where d.n > 0
    ) r on true
   where m.left_at is null
   group by m.student_id, m.squad_id
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

CREATE OR REPLACE FUNCTION public.settle_round(_season_id uuid, _round integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer := 0;
begin
  update public.squad_matches m set
    home_points = coalesce((select points from public.squad_weekly_scores
                             where season_id = _season_id and squad_id = m.home_squad and week = _round), 0),
    away_points = coalesce((select points from public.squad_weekly_scores
                             where season_id = _season_id and squad_id = m.away_squad and week = _round), 0),
    status = 'played'
   where m.season_id = _season_id and m.round_number = _round;
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.run_all_seasons()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s record; done integer := 0; moved integer := 0; closed integer := 0; wk integer;
begin
  for s in select * from public.seasons where is_current and status = 'active' loop
    -- The last week is over: score it (this settles the final), then close.
    if current_date >= s.starts_on + s.planned_weeks * 7 then
      perform public.run_squad_week(s.id, s.planned_weeks);
      done := done + 1;
      perform public.close_season(s.id);
      closed := closed + 1;
      continue;
    end if;

    wk := public.season_week(s.id);

    if wk > 1 then
      perform public.run_squad_week(s.id, wk - 1);
      done := done + 1;
    end if;

    if (select count(*) from public.squads where season_id = s.id and archived_at is null) >= 2 then
      perform public.advance_season(s.id);
      moved := moved + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'seasons_scored', done,
                            'seasons_advanced', moved, 'seasons_closed', closed,
                            'ran_at', now());
end $function$;

CREATE OR REPLACE FUNCTION public.generate_final(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  wk integer; starts date; winners uuid[]; a uuid; b uuid; semis integer;
begin
  select min(week) into wk from public.season_plan(_season_id) where phase = 'final';
  if wk is null then return jsonb_build_object('ok', false, 'note', 'no final week'); end if;
  select starts_on into starts from public.seasons where id = _season_id;

  select count(*) into semis from public.squad_matches
   where season_id = _season_id and stage = 'knockout' and status = 'played';

  if semis = 2 then
    select array_agg(id order by scheduled_at, id) into winners
      from (
        select case
                 when coalesce(m.home_points,0) > coalesce(m.away_points,0) then m.home_squad
                 when coalesce(m.away_points,0) > coalesce(m.home_points,0) then m.away_squad
                 else (select id from public.squads
                        where id in (m.home_squad, m.away_squad)
                        order by seed nulls last limit 1)
               end as id,
               m.scheduled_at
          from public.squad_matches m
         where m.season_id = _season_id and m.stage = 'knockout' and m.status = 'played'
      ) w;
    a := winners[1];
    b := winners[2];
  else
    select id into a from public.squads where season_id = _season_id and seed = 1;
    select id into b from public.squads where season_id = _season_id and seed = 2;
  end if;

  if a is null or b is null or a = b then
    return jsonb_build_object('ok', false, 'note', 'not enough squads to make a final');
  end if;

  delete from public.squad_matches where season_id = _season_id and stage = 'final';

  insert into public.squad_matches
    (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage)
  values (_season_id, wk, a, b,
          (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours', 'scheduled', 'final');

  perform public.write_audit('FINAL_GENERATED', 'squad_matches', _season_id, null,
    jsonb_build_object('week', wk), (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'week', wk);
end $function$;

CREATE OR REPLACE FUNCTION public.close_season(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  podium uuid[]; names text[];
  fin record; champ uuid; runner uuid; third uuid;
begin
  select * into fin from public.squad_matches
   where season_id = _season_id and stage = 'final' and status = 'played'
   order by scheduled_at desc limit 1;
  if fin.id is not null then
    champ := case
      when coalesce(fin.home_points, 0) > coalesce(fin.away_points, 0) then fin.home_squad
      when coalesce(fin.away_points, 0) > coalesce(fin.home_points, 0) then fin.away_squad
      else (select id from public.squads where id in (fin.home_squad, fin.away_squad)
             order by seed nulls last, points desc limit 1)
    end;
    runner := case when champ = fin.home_squad then fin.away_squad else fin.home_squad end;
    -- Third: the semi-final losers, better seed first.
    select q.id into third
      from public.squad_matches m
      join public.squads q on q.id in (m.home_squad, m.away_squad)
     where m.season_id = _season_id and m.stage = 'knockout' and m.status = 'played'
       and q.id not in (champ, runner)
     order by q.seed nulls last, q.points desc
     limit 1;
    podium := array[champ, runner, third];
  else
    select array_agg(id order by points desc nulls last, name)
      into podium
      from public.squads where season_id = _season_id;
  end if;
  select array_agg(q.name order by p.i) into names
    from unnest(podium) with ordinality p(id, i) join public.squads q on q.id = p.id;
  update public.seasons
     set status = 'complete', is_current = false, completed_at = now(),
         champion_squad_id  = podium[1],
         runner_up_squad_id = podium[2],
         third_squad_id     = podium[3]
   where id = _season_id;
  -- 160 (MF-016): the season lets its students go, so the next morning's formation can seat them again.
  update public.squad_members m set left_at = now()
    from public.squads q
   where q.id = m.squad_id and q.season_id = _season_id and m.left_at is null;
  update public.squads set archived_at = now()
   where season_id = _season_id and archived_at is null;
  perform public.write_audit('SEASON_CLOSED', 'seasons', _season_id, null,
    jsonb_build_object('champion', names[1], 'runner_up', names[2], 'third', names[3],
                       'decided_by', case when fin.id is not null then 'final' else 'points' end),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'champion', names[1],
                            'runner_up', names[2], 'third', names[3],
                            'decided_by', case when fin.id is not null then 'final' else 'points' end);
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
   where d.college_id is null;
$function$;

commit;
notify pgrst, 'reload schema';
