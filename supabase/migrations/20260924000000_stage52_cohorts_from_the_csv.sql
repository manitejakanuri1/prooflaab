-- ============================================================================
-- Stage 52 — a cohort can arrive from the CSV.
--
-- Stage 49 made the cohort the unit squads are formed inside, and backfilled
-- every existing student's cohort to their branch. That is only half of it: a
-- college uploads one file per branch and the file's own `section` column is
-- what separates CSE-A from CSE-B.
--
-- The import runs through the create-student-users edge function, which this
-- machine cannot deploy (that needs an interactive `supabase login`), so the
-- cohort is set from the browser straight afterwards instead, through
-- tpo_set_cohorts. It takes the same email addresses the import just used and
-- is scoped to the caller's own college, so a TPO cannot reach another
-- college's students with it.
--
-- A trigger also fills cohort from branch on any insert that leaves it null,
-- so a student created by any other route - the edge function, an admin, a
-- one-off - always lands in a cohort and never falls out of squad formation.
-- ============================================================================

create or replace function public.student_cohort_defaults()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.cohort is null or trim(new.cohort) = '' then
    new.cohort := nullif(trim(new.branch), '');
  end if;
  return new;
end $function$;

drop trigger if exists student_profiles_cohort_default on public.student_profiles;
create trigger student_profiles_cohort_default
  before insert on public.student_profiles
  for each row execute function public.student_cohort_defaults();

create or replace function public.tpo_set_cohorts(_assignments jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare cid uuid := public.my_college_id(); touched integer := 0;
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can set its own students'' cohorts';
  end if;

  with wanted as (
    select lower(trim(a->>'email')) as email,
           nullif(trim(a->>'cohort'), '') as cohort
      from jsonb_array_elements(_assignments) a
  )
  update public.student_profiles p
     set cohort = w.cohort
    from wanted w
    join public.student_contact c on lower(c.email) = w.email
   where p.id = c.student_id
     and w.cohort is not null
     and (p.college_id = cid or public.is_admin());

  get diagnostics touched = row_count;

  perform public.write_audit('COHORTS_SET', 'student_profiles', cid, null,
    jsonb_build_object('students', touched), cid);

  return jsonb_build_object('ok', true, 'students', touched);
end $function$;

revoke all on function public.tpo_set_cohorts(jsonb) from public, anon, authenticated;
grant execute on function public.tpo_set_cohorts(jsonb) to authenticated, service_role;
