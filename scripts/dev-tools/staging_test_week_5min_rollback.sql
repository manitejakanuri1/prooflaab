-- TEST WEBSITE ONLY: undo the 5-minute PRAGATI week.
\set ON_ERROR_STOP on
begin;
CREATE OR REPLACE FUNCTION public.season_week(_season_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select greatest(1, least(s.planned_weeks,
           (floor((current_date - s.starts_on) / 7.0) + 1)::int))
    from public.seasons s where s.id = _season_id;
$function$;

CREATE OR REPLACE FUNCTION public.season_week_bounds(_season_id uuid, _week integer)
 RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select (s.starts_on + ((_week - 1) * 7))::timestamptz,
         (s.starts_on + (_week * 7))::timestamptz
    from public.seasons s where s.id = _season_id;
$function$;

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

CREATE OR REPLACE FUNCTION public.notify_weekly_progress()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer;
begin
  insert into public.notifications (user_id, audience, source, type, title, message, link, dedupe_key)
  select w.student_id, 'student', 'system', 'weekly_progress',
         case when prev.points is null or w.points >= prev.points
              then 'Your week: ' || w.points || ' points'
              else 'Your week: ' || w.points || ' points (down from ' || prev.points || ')' end,
         'Week ' || w.week || ': ' || w.points || ' points' ||
           case when prev.points is not null
                then ', ' || (case when w.points >= prev.points then '+' else '' end)
                     || (w.points - prev.points) || ' vs last week'
                else '' end ||
           '. Open your season report for where it came from.',
         '/student/dashboard',
         'weekly_progress:' || w.season_id || ':' || w.week
    from public.student_weekly_scores w
    left join public.student_weekly_scores prev
      on prev.student_id = w.student_id and prev.season_id = w.season_id and prev.week = w.week - 1
   where w.week = (select max(w2.week) from public.student_weekly_scores w2 where w2.season_id = w.season_id)
     and w.computed_at >= now() - interval '2 hours'
     and w.points > 0
     and not exists (
       select 1 from public.notifications legacy
        where legacy.user_id = w.student_id
          and legacy.type = 'weekly_progress'
          and legacy.dedupe_key is null
          and legacy.message like 'Week ' || w.week || ':%'
          and legacy.created_at >= public.season_week_start(w.season_id, w.week)
          and legacy.created_at <  public.season_week_start(w.season_id, w.week) + interval '7 days'
     )
  on conflict (user_id, type, dedupe_key) where dedupe_key is not null do nothing;
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

CREATE OR REPLACE FUNCTION public.squad_swap_closes(_squad_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select ((s.starts_on + 7)::timestamp at time zone 'Asia/Kolkata')
    from public.squads q join public.seasons s on s.id = q.season_id
   where q.id = _squad_id and s.is_current and s.status = 'active' and q.archived_at is null;
$function$;

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

CREATE OR REPLACE FUNCTION public.generate_knockout(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  wk integer; starts date; n integer; created integer := 0;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid;
begin
  select min(week) into wk from public.season_plan(_season_id) where phase = 'knockout';
  if wk is null then return jsonb_build_object('ok', true, 'fixtures', 0); end if;
  select starts_on into starts from public.seasons where id = _season_id;

  select count(*) into n from public.squads
   where season_id = _season_id and qualified and archived_at is null and seed is not null;

  if n < 4 then
    return jsonb_build_object('ok', true, 'fixtures', 0,
                              'note', 'fewer than four seeded squads - straight to the final');
  end if;

  select id into s1 from public.squads where season_id = _season_id and seed = 1;
  select id into s2 from public.squads where season_id = _season_id and seed = 2;
  select id into s3 from public.squads where season_id = _season_id and seed = 3;
  select id into s4 from public.squads where season_id = _season_id and seed = 4;

  delete from public.squad_matches where season_id = _season_id and stage = 'knockout';

  insert into public.squad_matches
    (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage)
  values
    (_season_id, wk, s1, s4, (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours', 'scheduled', 'knockout'),
    (_season_id, wk, s2, s3, (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours', 'scheduled', 'knockout');
  created := 2;

  perform public.write_audit('KNOCKOUT_GENERATED', 'squad_matches', _season_id, null,
    jsonb_build_object('week', wk, 'fixtures', created),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'week', wk, 'fixtures', created);
end $function$;

CREATE OR REPLACE FUNCTION public.generate_round_robin(_season_id uuid, _force boolean DEFAULT false, _from_round integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ids uuid[]; real_squads integer; already_played integer;
  n integer; rounds integer; created integer := 0;
  weeks integer; cycle integer; cycles integer;
  r integer; i integer; wk integer;
  a uuid; b uuid; starts date; rotated uuid[];
begin
  -- Only rounds at or after the starting point matter: extending from week 8
  -- has no opinion about week 3.
  select count(*) into already_played from public.squad_matches
   where season_id = _season_id and status = 'played'
     and coalesce(round_number, 1) >= _from_round;

  if already_played > 0 and not _force then
    raise exception
      '% fixtures from round % onward have already been played. Regenerating would count them twice - rebuild the season only if you mean to discard those results.',
      already_played, _from_round;
  end if;

  select array_agg(id order by name) into ids
    from public.squads
   where season_id = _season_id and archived_at is null;
  if ids is null or array_length(ids, 1) < 2 then
    raise exception 'a round robin needs at least two squads';
  end if;

  real_squads := array_length(ids, 1);
  select starts_on, planned_weeks into starts, weeks from public.seasons where id = _season_id;

  delete from public.squad_matches
   where season_id = _season_id
     and coalesce(round_number, 1) >= _from_round;

  if real_squads % 2 = 1 then ids := ids || array[null::uuid]; end if;
  n := array_length(ids, 1);
  rounds := n - 1;
  cycles := ceil(weeks::numeric / rounds);

  for cycle in 1..cycles loop
    for r in 1..rounds loop
      wk := (cycle - 1) * rounds + r;
      exit when wk > weeks;

      -- The rotation still has to run from the top so the pairings stay a
      -- proper round robin; only the writing is skipped for past rounds.
      if r = 1 then rotated := ids;
      else rotated := array[ids[1]] || (rotated[n:n] || rotated[2:n-1]);
      end if;

      continue when wk < _from_round;

      for i in 1..(n / 2) loop
        a := rotated[i];
        b := rotated[n + 1 - i];
        if a is not null and b is not null then
          insert into public.squad_matches
            (season_id, round_number, home_squad, away_squad, scheduled_at, status)
          values (_season_id, wk,
                  case when cycle % 2 = 1 then a else b end,
                  case when cycle % 2 = 1 then b else a end,
                  (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours',
                  'scheduled');
          created := created + 1;
        end if;
      end loop;
    end loop;
  end loop;

  perform public.write_audit('ROUND_ROBIN_GENERATED', 'squad_matches', _season_id,
    null, jsonb_build_object('rounds', rounds, 'cycles', cycles,
                             'fixtures', created, 'rebuilt', _force,
                             'from_round', _from_round),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'rounds_per_cycle', rounds, 'cycles', cycles,
                            'weeks_covered', least(weeks, cycles * rounds),
                            'fixtures', created, 'squads', real_squads,
                            'from_round', _from_round,
                            'byes_per_cycle', case when real_squads % 2 = 1 then rounds else 0 end);
end $function$;

CREATE OR REPLACE FUNCTION public.schedule_round_robin(_season_id uuid, _squad_ids uuid[], _first_week integer, _last_week integer, _stage text, _cohort text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ids uuid[] := _squad_ids;
  n integer; rounds integer; created integer := 0;
  wk integer; r integer; cycle integer; step integer; i integer;
  rotated uuid[]; a uuid; b uuid; starts date;
begin
  if ids is null or array_length(ids, 1) < 2 then return 0; end if;
  if _last_week < _first_week then return 0; end if;

  select starts_on into starts from public.seasons where id = _season_id;

  if array_length(ids, 1) % 2 = 1 then ids := ids || array[null::uuid]; end if;
  n := array_length(ids, 1);
  rounds := n - 1;

  for wk in _first_week.._last_week loop
    r     := ((wk - _first_week) % rounds) + 1;
    cycle := ((wk - _first_week) / rounds) + 1;

    rotated := ids;
    for step in 1..(r - 1) loop
      rotated := array[rotated[1]] || (rotated[n:n] || rotated[2:n-1]);
    end loop;

    for i in 1..(n / 2) loop
      a := rotated[i];
      b := rotated[n + 1 - i];
      continue when a is null or b is null;

      insert into public.squad_matches
        (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage, cohort)
      values (_season_id, wk,
              case when cycle % 2 = 1 then a else b end,
              case when cycle % 2 = 1 then b else a end,
              (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours',
              'scheduled', _stage, _cohort);
      created := created + 1;
    end loop;
  end loop;

  return created;
end $function$;

drop function if exists public.test_fast_season(uuid);
commit;
