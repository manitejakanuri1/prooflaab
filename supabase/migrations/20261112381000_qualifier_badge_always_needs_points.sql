-- 381 (owner 12 Nov 2026, TEST only): "Championship Qualifier" always needs league points > 0. 346 still gave it to
--   0-point squads when every squad of the section had 0 points; now nobody gets it then. Only this badge changes:
--   squads.qualified / seeding (345) and the squad-page wording (src/lib/rankText.ts seedLine) stay as they are.
--   The badge is worked out on read (my_squad_achievements -> squad_championship_achievements); it is never stored,
--   so there are no saved badge rows to delete (checked on TEST: 0 rows in student_badges; badges has no qualifier).
-- Rollback: migration/381-rollback-qualifier-badge-always-needs-points.sql
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
     -- 381: the badge always needs league points, even when every squad of the section has 0
     and coalesce(q.points, 0) > 0
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

do $$
declare d text := pg_get_functiondef('public.squad_championship_achievements(uuid)'::regprocedure);
begin
  if position('381: the badge always needs league points' in d) = 0 or position('346:' in d) > 0
  then raise exception '381: not replaced'; end if;
  if exists (select 1 from public.squads q, public.squad_championship_achievements(q.id) a
              where q.archived_at is null and coalesce(q.points, 0) = 0 and a.title = 'Championship Qualifier')
  then raise exception '381: a 0-point squad still gets the badge'; end if;
  raise notice '381 self-check: true';
end $$;
notify pgrst, 'reload schema';
commit;
