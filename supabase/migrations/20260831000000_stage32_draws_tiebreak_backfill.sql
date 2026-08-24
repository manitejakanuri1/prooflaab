-- ============================================================================
-- Stage 32 — the league keeps an honest table.
--
-- Three holes, all found by reading the real season rather than the code.
--
--   1. A tie was not a result. Week 6 of the live season was Titans 52,
--      Strikers 52 — a genuine draw — and the settle logic recorded a win for
--      nobody and a loss for nobody. A squad's record did not add up to the
--      matches it had played.
--
--   2. Equal points were broken alphabetically. "Intellects" outranked
--      "Titans" for no reason connected to anything either squad did.
--
--   3. Rounds 1 to 5 were drawn and never settled, because the weekly job only
--      began running at week 6. The weekly scores for those weeks existed the
--      whole time, so the fixtures could be settled from what actually
--      happened — which is what the back-fill below does.
--
-- The weekly job also had its own private copy of the settling and recounting
-- logic, which is exactly how the draw case came to be handled in neither
-- place. Both now call the same two functions.
-- ============================================================================

alter table public.squads
  add column if not exists draws integer not null default 0;


-- Head-to-head, used only when points and wins are level: the squad that won
-- the matches they played against each other goes above.
create or replace function public.head_to_head(_a uuid, _b uuid, _season uuid)
returns integer language sql stable set search_path = public, pg_temp as $fn$
  select coalesce(sum(
    case
      when m.home_squad = _a and coalesce(m.home_points,0) > coalesce(m.away_points,0) then 1
      when m.away_squad = _a and coalesce(m.away_points,0) > coalesce(m.home_points,0) then 1
      when m.home_squad = _b and coalesce(m.home_points,0) > coalesce(m.away_points,0) then -1
      when m.away_squad = _b and coalesce(m.away_points,0) > coalesce(m.home_points,0) then -1
      else 0
    end), 0)
  from public.squad_matches m
  where m.season_id = _season and m.status = 'played'
    and ((m.home_squad = _a and m.away_squad = _b)
      or (m.home_squad = _b and m.away_squad = _a));
$fn$;


-- Recount wins, draws, losses and table position for a whole season from the
-- results as they stand. Recounted, never incremented: running it twice cannot
-- inflate a record, and the table can never drift from the fixtures it claims
-- to describe.
create or replace function public.recount_season(_season_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  update public.squads q set
    wins = (select count(*) from public.squad_matches x
             where x.season_id = _season_id and x.status = 'played'
               and ((x.home_squad = q.id and coalesce(x.home_points,0) > coalesce(x.away_points,0))
                 or (x.away_squad = q.id and coalesce(x.away_points,0) > coalesce(x.home_points,0)))),
    losses = (select count(*) from public.squad_matches x
               where x.season_id = _season_id and x.status = 'played'
                 and ((x.home_squad = q.id and coalesce(x.home_points,0) < coalesce(x.away_points,0))
                   or (x.away_squad = q.id and coalesce(x.away_points,0) < coalesce(x.home_points,0)))),
    draws = (select count(*) from public.squad_matches x
              where x.season_id = _season_id and x.status = 'played'
                and (x.home_squad = q.id or x.away_squad = q.id)
                and coalesce(x.home_points,0) = coalesce(x.away_points,0))
   where q.season_id = _season_id;

  -- Points, then wins, then head-to-head. The name is the last resort rather
  -- than the second one.
  with ordered as (
    select id,
           row_number() over (
             order by points desc,
                      wins desc,
                      (select coalesce(sum(public.head_to_head(s.id, o.id, _season_id)), 0)
                         from public.squads o
                        where o.season_id = _season_id and o.id <> s.id
                          and o.points = s.points and o.wins = s.wins) desc,
                      name
           ) as pos
      from public.squads s
     where s.season_id = _season_id
  )
  update public.squads q set rank = ordered.pos from ordered where q.id = ordered.id;
end $fn$;


-- Settle one round from the weekly scores that already exist. The weekly job
-- and the back-fill both call this, so a fixture is settled the same way
-- whichever path reaches it.
create or replace function public.settle_round(_season_id uuid, _round integer)
returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
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
end $fn$;


-- Settle every round that has already happened and was left behind.
create or replace function public.backfill_rounds(_season_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r record; settled integer := 0; wk integer := public.season_week(_season_id);
begin
  for r in
    select distinct round_number from public.squad_matches
     where season_id = _season_id and status = 'scheduled'
       and round_number is not null and round_number < wk
     order by round_number
  loop
    -- Only rounds with a weekly score behind them. A round nobody was ever
    -- scored for is left alone rather than settled 0-0 out of nothing.
    if exists (select 1 from public.squad_weekly_scores
                where season_id = _season_id and week = r.round_number) then
      settled := settled + public.settle_round(_season_id, r.round_number);
    end if;
  end loop;

  perform public.recount_season(_season_id);

  return jsonb_build_object('ok', true, 'rounds_settled', settled, 'current_week', wk);
end $fn$;


-- The weekly job, now sharing the two functions above instead of carrying its
-- own copy of them.
create or replace function public.run_squad_week(_season_id uuid, _week integer default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  wk integer := coalesce(_week, greatest(1, public.season_week(_season_id) - 1));
  ranked integer := 0;
  played integer := 0;
begin
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
        join public.squad_scoring_rules sr on sr.metric = e.event_type
       where e.student_id = m.student_id
         and e.occurred_at >= public.season_week_start(_season_id, wk)
         and e.occurred_at <  public.season_week_start(_season_id, wk) + interval '7 days'
       group by sr.metric, sr.points
    ) r on true
   where m.left_at is null
   group by m.student_id, m.squad_id
  on conflict (season_id, student_id, week)
    do update set points = excluded.points, breakdown = excluded.breakdown;

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
end $fn$;


-- The college's Achievements table reads its record from here, so it needs the
-- draw column too. Adding a column to the returned row means dropping and
-- recreating rather than replacing.
drop function if exists public.tpo_squad_achievements();

create function public.tpo_squad_achievements()
returns table (squad_id uuid, squad_name text, wins bigint, draws bigint, losses bigint,
               weeks_led bigint, best_rank integer, best_week_points integer,
               member_badges bigint, is_locked boolean, archived boolean)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select s.id, s.name,
         (select count(*) from public.squad_matches m
           where m.status = 'played'
             and ((m.home_squad = s.id and coalesce(m.home_points, 0) > coalesce(m.away_points, 0))
               or (m.away_squad = s.id and coalesce(m.away_points, 0) > coalesce(m.home_points, 0)))),
         (select count(*) from public.squad_matches m
           where m.status = 'played'
             and (m.home_squad = s.id or m.away_squad = s.id)
             and coalesce(m.home_points, 0) = coalesce(m.away_points, 0)),
         (select count(*) from public.squad_matches m
           where m.status = 'played'
             and ((m.home_squad = s.id and coalesce(m.home_points, 0) < coalesce(m.away_points, 0))
               or (m.away_squad = s.id and coalesce(m.away_points, 0) < coalesce(m.home_points, 0)))),
         (select count(*) from public.squad_weekly_scores w where w.squad_id = s.id and w.rank = 1),
         (select min(w.rank) from public.squad_weekly_scores w where w.squad_id = s.id),
         (select max(w.points) from public.squad_weekly_scores w where w.squad_id = s.id),
         (select count(*) from public.student_badges b
            join public.squad_members m on m.student_id = b.student_id and m.left_at is null
           where m.squad_id = s.id),
         s.is_locked, s.archived_at is not null
    from public.squads s
   where s.college_id = coalesce(public.my_college_id(), public.viewer_college_id())
   order by s.points desc;
$fn$;

revoke all on function public.head_to_head(uuid, uuid, uuid)  from public, anon, authenticated;
revoke all on function public.recount_season(uuid)            from public, anon, authenticated;
revoke all on function public.settle_round(uuid, integer)     from public, anon, authenticated;
revoke all on function public.backfill_rounds(uuid)           from public, anon, authenticated;
revoke all on function public.run_squad_week(uuid, integer)   from public, anon, authenticated;
revoke all on function public.tpo_squad_achievements()        from public, anon;

grant execute on function public.head_to_head(uuid, uuid, uuid) to service_role;
grant execute on function public.recount_season(uuid)           to service_role;
grant execute on function public.settle_round(uuid, integer)    to service_role;
grant execute on function public.backfill_rounds(uuid)          to service_role;
grant execute on function public.run_squad_week(uuid, integer)  to service_role;
grant execute on function public.tpo_squad_achievements()       to authenticated;

-- Settle the rounds that were left behind in every season already running.
do $$
declare s record;
begin
  for s in select id from public.seasons where status = 'active' loop
    perform public.backfill_rounds(s.id);
  end loop;
end $$;
