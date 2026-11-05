-- Read-only. For each finished week of every active season with squads, except the QA demo:
-- Lots that needed scoring, squads scored, and matches never settled. Counts only, no student names.
select 'PAST_WEEK: ' || c.name || ' | started ' || s.starts_on || ' | week ' || w
    || ' | lots ' || (select count(*) from public.squad_members m join public.squads q on q.id = m.squad_id
                        cross join lateral public.lot_marks(m.student_id, b.starts_at, b.ends_at) lm
                       where q.season_id = s.id and m.left_at is null)
    || ' | squads_scored ' || (select count(*) from public.squad_weekly_scores x where x.season_id = s.id and x.week = w)
    || ' | matches_unsettled ' || (select count(*) from public.squad_matches m where m.season_id = s.id and m.round_number = w and m.status = 'scheduled')
  from public.seasons s
  join public.colleges c on c.id = s.college_id
  cross join lateral generate_series(1, public.season_week(s.id) - 1) w
  cross join lateral public.season_week_bounds(s.id, w) b
 where s.status = 'active' and c.name <> 'ProofLab QA Demo'
   and exists (select 1 from public.squads q where q.season_id = s.id)
 order by c.name, s.starts_on, w;
-- The grants on the two tables today, so the rollback of migration 216 can restore them exactly.
select 'GRANTS: ' || relname || ' | ' || coalesce(relacl::text, 'default') from pg_class
 where oid in ('public.daily_marks'::regclass, 'public.season_champions'::regclass) order by relname;
