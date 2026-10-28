-- ROLLBACK for 161: records count every played match again.
begin;

CREATE OR REPLACE FUNCTION public.recount_season(_season_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- Points first, then wins, then head-to-head. Name is the last resort rather
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
end $function$;

CREATE OR REPLACE FUNCTION public.tpo_squad_achievements()
 RETURNS TABLE(squad_id uuid, squad_name text, wins bigint, draws bigint, losses bigint, weeks_led bigint, best_rank integer, best_week_points integer, member_badges bigint, is_locked boolean, archived boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

select public.recount_season(id) from public.seasons;

commit;
notify pgrst, 'reload schema';
