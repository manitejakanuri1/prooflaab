-- Rollback of 346: the badge as it was before.
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
notify pgrst, 'reload schema';
commit;
