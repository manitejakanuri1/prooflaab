-- STAGING ONLY. Ends the SIM12 season after today's real work (week 12): scores week 12,
-- which also settles the final, then closes the season the way the Sunday job does.
\set ON_ERROR_STOP on
select set_config('request.jwt.claims', '{"role":"service_role"}', false);

do $$
declare sid uuid;
begin
  select id into sid from public.seasons
   where college_id = '5112c011-0000-4000-9000-000000000001' and is_current;
  if sid is null then raise exception 'SIM12 season not found or already closed.'; end if;
  raise notice 'week 12: %', public.run_squad_week(sid, 12);
  raise notice 'close: %', public.close_season(sid);
end $$;

select 'FINAL | ' || h.name || ' ' || coalesce(m.home_points::text, '-') || ' v ' || coalesce(m.away_points::text, '-') || ' ' || a.name
  from public.squad_matches m join public.squads h on h.id = m.home_squad join public.squads a on a.id = m.away_squad
  join public.seasons s on s.id = m.season_id
 where s.college_id = '5112c011-0000-4000-9000-000000000001' and m.stage = 'final';
select 'CHAMPION (season row) | ' || c.name || ' | runner-up ' || r.name
  from public.seasons s join public.squads c on c.id = s.champion_squad_id join public.squads r on r.id = s.runner_up_squad_id
 where s.college_id = '5112c011-0000-4000-9000-000000000001';
select 'WEEK12 real work | ' || p.full_name || ' | pts ' || w.points || ' | ' || w.breakdown
  from public.student_weekly_scores w join public.student_profiles p on p.id = w.student_id
 where w.week = 12 and p.full_name in ('Sim Student 1', 'Sim Student 2', 'Sim Student 3')
   and w.season_id in (select id from public.seasons where college_id = '5112c011-0000-4000-9000-000000000001');
