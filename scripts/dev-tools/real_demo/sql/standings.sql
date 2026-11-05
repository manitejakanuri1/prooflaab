-- Read-only: the demo season's week and standings.
with s as (select x.* from public.seasons x join public.colleges c on c.id = x.college_id
            where c.email = 'college@qa-demo.prooflab.invalid' order by x.created_at desc limit 1)
select l from (
  select 1 o, 0 r, 'WEEK: ' || s.name || ' | ' ||
         case when s.status = 'complete' then 'CLOSED (season over)'
              else 'week ' || public.season_week(s.id) || ' of ' || s.planned_weeks || ' | ' || public.season_phase(s.id) || ' | ' ||
                   (select label from public.season_plan(s.id) p where p.week = public.season_week(s.id)) end l from s
  union all
  select 2, row_number() over (order by q.points desc, q.name),
         'STANDING: ' || q.name || ' | points ' || q.points || ' | won ' || q.wins || ' drawn ' || q.draws || ' lost ' || q.losses ||
         ' | seed ' || coalesce(q.seed::text, '-')
    from public.squads q, s where q.season_id = s.id
  union all
  select 3, m.round_number, 'MATCH: week ' || m.round_number || ' | ' || m.stage || ' | ' || h.name || ' ' || coalesce(m.home_points::text, '-') ||
         ' v ' || coalesce(m.away_points::text, '-') || ' ' || a.name || ' | ' || m.status
    from public.squad_matches m join public.squads h on h.id = m.home_squad join public.squads a on a.id = m.away_squad, s
   where m.season_id = s.id and (m.stage <> 'league' or m.round_number between public.season_week(s.id) - 1 and public.season_week(s.id))
  union all
  select 4, 0, 'CHAMPION: ' || c.bracket || ' | ' || q.name from public.season_champions c join public.squads q on q.id = c.champion_squad_id, s where c.season_id = s.id
) x order by o, r;
