-- Rollback of 381: put back the 346 rule (all-zero section still gets the badge).
-- was: 346 (Grok retest 12 Nov 2026, F19; TEST only): Achievements showed "Championship Qualifier" for a squad on
--   0 points. The badge now follows the 345 rule: a 0-point squad is not a qualifier unless every squad of its
--   section (bracket, else cohort) has 0 points. Also covers squads seeded before 345.
-- Rollback: migration/346-rollback-qualifier-badge-needs-points.sql
begin;
CREATE OR REPLACE FUNCTION public.squad_championship_achievements(_squad_id uuid)
 RETURNS TABLE(kind text, title text, detail text, achieved_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select 'championship'::text, 'Championship Qualifier'::text,
         ('Top of ' || coalesce(q.cohort, 'the cohort') || ' - through to the championship')::text,
         q.updated_at
    from public.squads q
   where q.id = _squad_id and q.qualified
     -- 346: same rule as 345 - a 0-point squad is no qualifier unless every squad of its section has 0 points
     and (coalesce(q.points, 0) > 0
          or not exists (select 1 from public.squads o
                          where o.season_id = q.season_id
                            and coalesce(o.bracket, o.cohort, '') = coalesce(q.bracket, q.cohort, '')
                            and coalesce(o.points, 0) > 0))
  union all
  select 'championship'::text, 'Finalist'::text,
         'Reached the grand final'::text, m.scheduled_at
    from public.squad_matches m
   where m.stage = 'final' and (m.home_squad = _squad_id or m.away_squad = _squad_id)
  union all
  select 'championship'::text, 'Season Champion'::text,
         'Won the season'::text, s.completed_at
    from public.seasons s
   where s.champion_squad_id = _squad_id;
$function$
;

do $$ begin
  if position('346: same rule as 345' in pg_get_functiondef('public.squad_championship_achievements(uuid)'::regprocedure)) = 0
  then raise exception '346: not replaced'; end if;
  raise notice '381 rollback: 346 rule back';
end $$;
notify pgrst, 'reload schema';
commit;
