-- Stage 16, part two: the functions that turn a week of student activity into
-- a squad score, a rank and a settled fixture. Split from the tables only
-- because they are long, not because they are separable — neither half means
-- anything without the other.

-- ── week number to dates ────────────────────────────────────────────────
create or replace function public.season_week_bounds(_season_id uuid, _week integer)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable set search_path = public, pg_temp as $fn$
  select (s.starts_on + ((_week - 1) * 7))::timestamptz,
         (s.starts_on + (_week * 7))::timestamptz
    from public.seasons s where s.id = _season_id;
$fn$;


-- ── steps 1 and 2: what one student was worth in one week ───────────────
create or replace function public.score_student_week(
  _student_id uuid, _season_id uuid, _week integer
) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  b timestamptz; e timestamptz;
  breakdown jsonb := '{}'::jsonb;
  total integer := 0;
  r record; n integer;
begin
  select starts_at, ends_at into b, e from public.season_week_bounds(_season_id, _week);
  if b is null then return jsonb_build_object('points', 0, 'breakdown', '{}'::jsonb); end if;

  for r in select * from public.squad_scoring_rules loop
    if r.metric = 'active_day' then
      -- Counted once per calendar day. A student who does eight things on
      -- Monday and nothing else has had one active day, not eight.
      select count(distinct occurred_at::date) into n
        from public.student_activity_events
       where student_id = _student_id and occurred_at >= b and occurred_at < e;
    else
      select count(*) into n
        from public.student_activity_events
       where student_id = _student_id and event_type = r.metric
         and occurred_at >= b and occurred_at < e;
    end if;

    if n > 0 then
      breakdown := breakdown || jsonb_build_object(r.metric,
                     jsonb_build_object('count', n, 'points', n * r.points));
      total := total + (n * r.points);
    end if;
  end loop;

  return jsonb_build_object('points', total, 'breakdown', breakdown);
end $fn$;


-- ── steps 3 to 6: aggregate, rank, publish, settle ──────────────────────
create or replace function public.run_squad_week(_season_id uuid, _week integer default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  wk integer; s record; m record; mt record; sc jsonb;
  squad_total integer; squad_active integer; squad_count integer;
  ranked integer := 0; played integer := 0;
begin
  wk := coalesce(_week, public.season_week(_season_id));
  if wk is null then raise exception 'no such season'; end if;

  for s in select * from public.squads where season_id = _season_id loop
    squad_total := 0; squad_active := 0; squad_count := 0;

    for m in select * from public.squad_members
              where squad_id = s.id and left_at is null loop
      sc := public.score_student_week(m.student_id, _season_id, wk);
      squad_count := squad_count + 1;
      if (sc ->> 'points')::int > 0 then squad_active := squad_active + 1; end if;
      squad_total := squad_total + (sc ->> 'points')::int;

      insert into public.student_weekly_scores
        (season_id, student_id, squad_id, week, points, breakdown)
      values (_season_id, m.student_id, s.id, wk, (sc ->> 'points')::int, sc -> 'breakdown')
      on conflict (season_id, student_id, week) do update
        set points = excluded.points, breakdown = excluded.breakdown,
            squad_id = excluded.squad_id, computed_at = now();

      -- Contribution is this week's points, so somebody who has stopped showing
      -- up stops carrying credit for what they did a month ago.
      update public.squad_members set contribution = (sc ->> 'points')::int where id = m.id;
    end loop;

    insert into public.squad_weekly_scores
      (season_id, squad_id, week, points, active_members, total_members)
    values (_season_id, s.id, wk, squad_total, squad_active, squad_count)
    on conflict (season_id, squad_id, week) do update
      set points = excluded.points, active_members = excluded.active_members,
          total_members = excluded.total_members, computed_at = now();
  end loop;

  with r as (
    select squad_id, rank() over (order by points desc, squad_id) as pos
      from public.squad_weekly_scores where season_id = _season_id and week = wk
  )
  update public.squad_weekly_scores w set rank = r.pos
    from r where w.squad_id = r.squad_id and w.season_id = _season_id and w.week = wk;

  -- Season points are the sum of every week scored so far, not just this one.
  update public.squads q
     set previous_rank = q.rank,
         points = coalesce((select sum(points) from public.squad_weekly_scores
                             where season_id = _season_id and squad_id = q.id), 0)
   where q.season_id = _season_id;

  with r as (
    select id, rank() over (order by points desc, name) as pos
      from public.squads where season_id = _season_id
  )
  update public.squads q set rank = r.pos from r where q.id = r.id;

  select count(*) into ranked from public.squads where season_id = _season_id;

  -- Only this round's fixture, matched by the round it belongs to rather than
  -- by having been scheduled at any point in the past. A match is not a
  -- separate thing students play: it is the same week's work, read head to head.
  for mt in select * from public.squad_matches
             where season_id = _season_id and round_number = wk loop
    update public.squad_matches set
      home_points = coalesce((select points from public.squad_weekly_scores
                               where season_id = _season_id and squad_id = mt.home_squad and week = wk), 0),
      away_points = coalesce((select points from public.squad_weekly_scores
                               where season_id = _season_id and squad_id = mt.away_squad and week = wk), 0),
      status = 'played'
     where id = mt.id;
    played := played + 1;
  end loop;

  -- Recounted from results rather than incremented, so running this twice
  -- cannot inflate a record.
  update public.squads q set
    wins = (select count(*) from public.squad_matches x where x.season_id = _season_id and x.status='played'
             and ((x.home_squad = q.id and x.home_points > x.away_points)
               or (x.away_squad = q.id and x.away_points > x.home_points))),
    losses = (select count(*) from public.squad_matches x where x.season_id = _season_id and x.status='played'
             and ((x.home_squad = q.id and x.home_points < x.away_points)
               or (x.away_squad = q.id and x.away_points < x.home_points)))
   where q.season_id = _season_id;

  perform public.write_audit('SQUAD_WEEK_SCORED', 'squad_weekly_scores', _season_id,
    null, jsonb_build_object('week', wk, 'squads', ranked, 'matches_settled', played),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'week', wk, 'squads_scored', ranked,
                            'matches_settled', played);
end $fn$;


-- ── the draw ────────────────────────────────────────────────────────────
-- Circle method: one squad held still, the rest rotated around it. With an odd
-- number of squads one sits out each round, which is what a bye is. The whole
-- draw repeats until the season runs out, because a three-squad competition is
-- three rounds and a season is ten weeks.
create or replace function public.generate_round_robin(
  _season_id uuid, _force boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  ids uuid[]; real_squads integer; already_played integer;
  n integer; rounds integer; created integer := 0;
  weeks integer; cycle integer; cycles integer;
  r integer; i integer; wk integer;
  a uuid; b uuid; starts date; rotated uuid[];
begin
  select count(*) into already_played from public.squad_matches
   where season_id = _season_id and status = 'played';

  -- Silently deleting played matches is the other wrong answer, because those
  -- are results. So it refuses and says why, and rebuilding must be asked for.
  if already_played > 0 and not _force then
    raise exception
      '% fixtures in this season have already been played. Regenerating would count them twice - rebuild the season only if you mean to discard those results.',
      already_played;
  end if;

  select array_agg(id order by name) into ids
    from public.squads where season_id = _season_id;
  if ids is null or array_length(ids, 1) < 2 then
    raise exception 'a round robin needs at least two squads';
  end if;

  real_squads := array_length(ids, 1);
  select starts_on, planned_weeks into starts, weeks from public.seasons where id = _season_id;

  delete from public.squad_matches where season_id = _season_id;

  if real_squads % 2 = 1 then ids := ids || array[null::uuid]; end if;
  n := array_length(ids, 1);
  rounds := n - 1;
  cycles := ceil(weeks::numeric / rounds);

  for cycle in 1..cycles loop
    for r in 1..rounds loop
      wk := (cycle - 1) * rounds + r;
      exit when wk > weeks;

      if r = 1 then rotated := ids;
      else rotated := array[ids[1]] || (rotated[n:n] || rotated[2:n-1]);
      end if;

      for i in 1..(n / 2) loop
        a := rotated[i];
        b := rotated[n + 1 - i];
        -- A null on either side is the bye: that squad does not play this round.
        if a is not null and b is not null then
          insert into public.squad_matches
            (season_id, round_number, home_squad, away_squad, scheduled_at, status)
          -- Sides swap each cycle, so a squad drawn at home in the first pass
          -- is away in the second.
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
                             'fixtures', created, 'rebuilt', _force),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'rounds_per_cycle', rounds, 'cycles', cycles,
                            'weeks_covered', least(weeks, cycles * rounds),
                            'fixtures', created, 'squads', real_squads,
                            'byes_per_cycle', case when real_squads % 2 = 1 then rounds else 0 end);
end $fn$;

-- The pre-force overload is dead and only creates ambiguity about which runs.
drop function if exists public.generate_round_robin(uuid);


-- ── what a college may run ──────────────────────────────────────────────
-- Both resolve the caller's own current season, so a college cannot score or
-- re-fixture somebody else's competition.
create or replace function public.tpo_run_week(_week integer default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare cid uuid := public.my_college_id(); sid uuid;
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can score its own season'; end if;
  select id into sid from public.seasons
   where college_id = cid and is_current order by starts_on desc limit 1;
  if sid is null then raise exception 'no season is running'; end if;
  return public.run_squad_week(sid, _week);
end $fn$;

create or replace function public.tpo_generate_fixtures(_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare cid uuid := public.my_college_id(); sid uuid;
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can fixture its own season'; end if;
  select id into sid from public.seasons
   where college_id = cid and is_current order by starts_on desc limit 1;
  if sid is null then raise exception 'no season is running'; end if;
  return public.generate_round_robin(sid, _force);
end $fn$;

revoke all on function public.season_week_bounds(uuid, integer) from public, anon;
revoke all on function public.score_student_week(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.run_squad_week(uuid, integer) from public, anon, authenticated;
revoke all on function public.generate_round_robin(uuid, boolean) from public, anon, authenticated;
revoke all on function public.tpo_run_week(integer) from public, anon;
revoke all on function public.tpo_generate_fixtures(boolean) from public, anon;

grant execute on function public.season_week_bounds(uuid, integer) to authenticated;
grant execute on function public.tpo_run_week(integer) to authenticated;
grant execute on function public.tpo_generate_fixtures(boolean) to authenticated;
