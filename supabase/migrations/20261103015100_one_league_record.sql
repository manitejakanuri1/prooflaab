-- 161 (MF-009): one win-draw-loss record per squad.
-- Before: recount_season and tpo_squad_achievements counted every played match (league + championship +
-- knockout + final), so a squad could show 14 results from 9 league matches, and the history table counted
-- on its own. Now recount_season counts league matches only and tpo_squad_achievements reads that stored record.
-- Every season is recounted once at the end so the stored records are right straight away.
-- Rollback: migration/161-rollback-one-league-record.sql (then recount again)
begin;

CREATE OR REPLACE FUNCTION public.recount_season(_season_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- 161 (MF-009): win-draw-loss counts league matches only (championship, knockout and final are shown as
  -- their own results, not added to the league record).
  update public.squads q set
    wins = (select count(*) from public.squad_matches x
             where x.season_id = _season_id and x.status = 'played' and x.stage = 'league'
               and ((x.home_squad = q.id and coalesce(x.home_points,0) > coalesce(x.away_points,0))
                 or (x.away_squad = q.id and coalesce(x.away_points,0) > coalesce(x.home_points,0)))),
    losses = (select count(*) from public.squad_matches x
               where x.season_id = _season_id and x.status = 'played' and x.stage = 'league'
                 and ((x.home_squad = q.id and coalesce(x.home_points,0) < coalesce(x.away_points,0))
                   or (x.away_squad = q.id and coalesce(x.away_points,0) < coalesce(x.home_points,0)))),
    draws = (select count(*) from public.squad_matches x
              where x.season_id = _season_id and x.status = 'played' and x.stage = 'league'
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
  -- 161 (MF-009): the record is the one recount_season keeps on the squad (league matches only), so every
  -- screen shows the same win-draw-loss.
  select s.id, s.name, s.wins::bigint, s.draws::bigint, s.losses::bigint,
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

do $$
begin
  if exists (select 1 from public.squads q
              where q.wins + q.draws + q.losses <> (select count(*) from public.squad_matches x
                                                    where x.status = 'played' and x.stage = 'league'
                                                      and q.id in (x.home_squad, x.away_squad))) then
    raise exception '161: a squad record does not match its league matches';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
