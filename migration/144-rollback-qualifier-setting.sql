-- Rollback of 144: restores the fixed rule (2 per section, 4 for a single section) and drops the setting.
begin;

create or replace function public.qualify_squads(_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  cohorts integer; per_cohort integer; through integer;
begin
  select count(distinct coalesce(cohort, 'GENERAL')) into cohorts
    from public.squads where season_id = _season_id and archived_at is null;
  per_cohort := case when cohorts <= 1 then 4 else 2 end;
  with ranked as (
    select id,
           row_number() over (
             partition by coalesce(cohort, 'GENERAL')
             order by points desc, wins desc, name
           ) as pos
      from public.squads
     where season_id = _season_id and archived_at is null
  )
  update public.squads q
     set qualified = (ranked.pos <= per_cohort)
    from ranked
   where q.id = ranked.id;
  select count(*) into through
    from public.squads where season_id = _season_id and qualified;
  perform public.write_audit('SQUADS_QUALIFIED', 'squads', _season_id, null,
    jsonb_build_object('cohorts', cohorts, 'per_cohort', per_cohort, 'qualified', through),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'cohorts', cohorts,
                            'per_cohort', per_cohort, 'qualified', through);
end $function$;

drop function if exists public.tpo_set_qualifiers(integer);
drop function if exists public.tpo_qualifier_setting();
alter table public.colleges drop column if exists qualifiers_per_cohort;

commit;
notify pgrst, 'reload schema';
