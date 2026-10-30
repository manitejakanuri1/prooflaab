-- Rollback of 178: sections counted from the current season's squads only.
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
  return jsonb_build_object('per_cohort', chosen,
                            'default_per_cohort', case when coalesce(cohorts, 0) <= 1 then 4 else 2 end,
                            'cohorts', coalesce(cohorts, 0));
end $fn$;
commit;
