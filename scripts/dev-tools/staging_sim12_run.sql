-- STAGING ONLY. Plays the SIM12 season week by week, exactly as the Sunday job would have
-- (run_all_seasons): at the start of week k, score week k-1, then build that phase's fixtures
-- (league, qualification + championship, seeding, knockout, final).
-- The Sunday job reads the week from today's date; here the week is passed in, because the
-- season was started 77 days ago and every past week is already in the past.
--   :upto = last week to move INTO (2..12). Run with 6, then 11, then 12 to stop and look between.
-- Week 12 itself (today's real work) is scored later by staging_sim12_close.sql.
\set ON_ERROR_STOP on
\if :{?upto}
\else
  \set upto 12
\endif

select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select set_config('sim12.upto', :'upto', false);

do $$
declare
  sid uuid; k integer; ph text; done integer; upto integer := current_setting('sim12.upto')::int;
begin
  select id into sid from public.seasons
   where college_id = '5112c011-0000-4000-9000-000000000001' and is_current;
  if sid is null then raise exception 'SIM12 season not found. Run staging_sim12_setup.sql first.'; end if;

  -- Resume after the last week already scored, so the file can be run in parts.
  select coalesce(max(week), 0) + 2 into k from public.squad_weekly_scores where season_id = sid;
  k := greatest(k, 2);

  while k <= upto loop
    perform public.run_squad_week(sid, k - 1);
    ph := public.season_phase(sid, k);

    -- advance_season(), with the week given instead of read from the date.
    if ph = 'league' and not exists (select 1 from public.squad_matches where season_id = sid and stage = 'league') then
      perform public.generate_cohort_league(sid, false);
    elsif ph = 'championship' and not exists (select 1 from public.squad_matches where season_id = sid and stage = 'championship') then
      perform public.qualify_squads(sid);
      perform public.generate_championship(sid);
    elsif ph = 'seeding' and exists (select 1 from public.squads where season_id = sid and qualified) then
      perform public.seed_championship(sid);
    elsif ph = 'knockout' and not exists (select 1 from public.squad_matches where season_id = sid and stage = 'knockout') then
      perform public.generate_knockout(sid);
    elsif ph = 'final' and not exists (select 1 from public.squad_matches where season_id = sid and stage = 'final') then
      perform public.generate_final(sid);
    end if;

    raise notice 'week % scored; now in week % (%)', k - 1, k, ph;
    k := k + 1;
  end loop;
end $$;

-- What a person would check on the College screen.
select 'WEEK ' || w.week || ' | ' || q.cohort || ' | ' || q.name || ' | pts ' || w.points || ' | rank ' || w.rank
       || ' | active ' || w.active_members || '/' || w.total_members
  from public.squad_weekly_scores w join public.squads q on q.id = w.squad_id
  join public.seasons s on s.id = w.season_id
 where s.college_id = '5112c011-0000-4000-9000-000000000001' and s.is_current
 order by w.week, q.cohort, w.rank;

select 'MATCH wk ' || m.round_number || ' | ' || m.stage || ' | ' || h.name || ' ' || coalesce(m.home_points::text, '-')
       || ' v ' || coalesce(m.away_points::text, '-') || ' ' || coalesce(a.name, 'BYE') || ' | ' || m.status
  from public.squad_matches m join public.squads h on h.id = m.home_squad left join public.squads a on a.id = m.away_squad
  join public.seasons s on s.id = m.season_id
 where s.college_id = '5112c011-0000-4000-9000-000000000001' and s.is_current
 order by m.round_number, m.stage, h.name;

select 'TABLE | ' || q.cohort || ' | ' || q.name || ' | pts ' || q.points || ' | W' || q.wins || ' D' || q.draws || ' L' || q.losses
       || ' | qualified ' || coalesce(q.qualified::text, '-') || ' | seed ' || coalesce(q.seed::text, '-')
  from public.squads q join public.seasons s on s.id = q.season_id
 where s.college_id = '5112c011-0000-4000-9000-000000000001' and s.is_current
 order by q.cohort, q.points desc;
