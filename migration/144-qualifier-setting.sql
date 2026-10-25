-- 144: a college chooses how many squads per section go through to the championship (owner request, 26 Oct 2026).
--
-- WHY. qualify_squads() (migration 50) fixed the number: top 2 squads per section, or top 4 when a college has a
-- single section. A college could not change it.
--
-- NOW. colleges.qualifiers_per_cohort (1 to 8, null = the old rule). qualify_squads() reads it for the season's
-- college. tpo_qualifier_setting() shows the college its current choice and what the default rule would give;
-- tpo_set_qualifiers(n) sets it, tpo_set_qualifiers(null) goes back to the default. A change takes effect the next
-- time qualification runs (when the league ends); squads already marked qualified are not re-marked.
-- Nothing else in qualify_squads changes (same ranking, same audit line, same return shape).
begin;

alter table public.colleges
  add column if not exists qualifiers_per_cohort integer
  check (qualifiers_per_cohort is null or qualifiers_per_cohort between 1 and 8);
comment on column public.colleges.qualifiers_per_cohort is
  'Squads per section that go through to the championship. Null = the default rule (2 per section, 4 for a single section).';

create or replace function public.qualify_squads(_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  cohorts integer; per_cohort integer; through integer; chosen integer;
begin
  select count(distinct coalesce(cohort, 'GENERAL')) into cohorts
    from public.squads where season_id = _season_id and archived_at is null;

  -- The college's own choice, when it made one.
  select c.qualifiers_per_cohort into chosen
    from public.seasons s join public.colleges c on c.id = s.college_id
   where s.id = _season_id;

  -- Default: two per cohort. A college running a single cohort would get a two-squad
  -- championship out of that, which is not a championship, so a lone cohort sends four.
  per_cohort := coalesce(chosen, case when cohorts <= 1 then 4 else 2 end);

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
    jsonb_build_object('cohorts', cohorts, 'per_cohort', per_cohort, 'qualified', through,
                       'chosen_by_college', chosen is not null),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'cohorts', cohorts,
                            'per_cohort', per_cohort, 'qualified', through);
end $function$;

create or replace function public.tpo_qualifier_setting()
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $fn$
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

create or replace function public.tpo_set_qualifiers(_per_cohort integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare cid uuid := public.my_college_id(); old integer;
begin
  if cid is null then raise exception 'Only a college can set this.'; end if;
  if _per_cohort is not null and (_per_cohort < 1 or _per_cohort > 8) then
    raise exception 'Choose between 1 and 8 squads per section.';
  end if;
  select qualifiers_per_cohort into old from public.colleges where id = cid;
  update public.colleges set qualifiers_per_cohort = _per_cohort where id = cid;
  perform public.write_audit('QUALIFIERS_SET', 'colleges', cid,
    jsonb_build_object('per_cohort', old), jsonb_build_object('per_cohort', _per_cohort), cid);
  return jsonb_build_object('ok', true, 'per_cohort', _per_cohort);
end $fn$;

revoke all on function public.tpo_qualifier_setting(), public.tpo_set_qualifiers(integer) from public, anon, authenticated;
grant execute on function public.tpo_qualifier_setting(), public.tpo_set_qualifiers(integer) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'colleges' and column_name = 'qualifiers_per_cohort') then
    raise exception '144 self-check: colleges.qualifiers_per_cohort is missing';
  end if;
  if has_function_privilege('anon', 'public.tpo_set_qualifiers(integer)', 'execute') then
    raise exception '144 self-check: anon can set the qualifier count';
  end if;
  if not has_function_privilege('authenticated', 'public.tpo_set_qualifiers(integer)', 'execute') then
    raise exception '144 self-check: a college cannot set the qualifier count';
  end if;
  if has_function_privilege('authenticated', 'public.qualify_squads(uuid)', 'execute') then
    raise exception '144 self-check: qualify_squads became callable by clients';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
