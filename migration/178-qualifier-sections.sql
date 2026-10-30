-- 178 (MF-050, 30 Oct 2026): the qualifier setting counts the college's sections correctly between seasons.
--   It counted sections only from the current season's squads, so with no season running it said 0 -> "you have
--   one section". When there are no current squads it now counts the sections the students are in (the same
--   section rule squad formation uses). During a season nothing changes.
-- Rollback: migration/178-rollback-qualifier-sections.sql
begin;

create or replace function public.tpo_qualifier_setting()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare cid uuid := public.my_college_id(); chosen integer; cohorts integer;
begin
  if cid is null then raise exception 'Only a college can read this.'; end if;
  select qualifiers_per_cohort into chosen from public.colleges where id = cid;
  select count(distinct coalesce(q.cohort, 'GENERAL')) into cohorts
    from public.squads q join public.seasons s on s.id = q.season_id
   where s.college_id = cid and s.is_current and q.archived_at is null;
  if coalesce(cohorts, 0) = 0 then
    -- 178: no season running - the sections the students are in
    select count(distinct coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL')) into cohorts
      from public.student_profiles p
     where p.college_id = cid and p.onboarding_status <> 'blocked';
  end if;
  return jsonb_build_object('per_cohort', chosen,
                            'default_per_cohort', case when coalesce(cohorts, 0) <= 1 then 4 else 2 end,
                            'cohorts', coalesce(cohorts, 0));
end $fn$;

do $$
begin
  if pg_get_functiondef('public.tpo_qualifier_setting()'::regprocedure) !~ 'no season running' then
    raise exception '178: sections still counted from current squads only';
  end if;
end $$;

commit;
