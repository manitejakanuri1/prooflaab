-- 540 (N13, 13 Nov 2026): the admin student drawer called tpo_sections() and got 400
-- "Only a college can read this." (the function only knew the college's own login).
-- New overload tpo_sections(_student_id): a college gets its own sections (as before); an admin gets the
-- sections of that student's college. Read-only; nobody else. The zero-argument version is unchanged.
begin;
create or replace function public.tpo_sections(_student_id uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare cid uuid := public.my_college_id();
begin
  if cid is null and public.is_admin() then
    select college_id into cid from public.student_profiles where id = _student_id;
    if cid is null then return '[]'::jsonb; end if;
  end if;
  if cid is null then raise exception 'Only a college can read this.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('cohort', x.cohort, 'students', x.n) order by x.cohort)
      from (select cohort, count(*) as n
              from public.student_profiles
             where college_id = cid and cohort is not null
             group by cohort) x), '[]'::jsonb);
end $function$;
revoke all on function public.tpo_sections(uuid) from public, anon;
grant execute on function public.tpo_sections(uuid) to authenticated, service_role;
do $$
begin
  if to_regprocedure('public.tpo_sections(uuid)') is null then raise exception '540 self-check: overload missing'; end if;
  if to_regprocedure('public.tpo_sections()') is null then raise exception '540 self-check: old version gone'; end if;
  if has_function_privilege('anon', 'public.tpo_sections(uuid)', 'execute') then raise exception '540 self-check: anon can run it'; end if;
  raise notice '540 self-check: true';
end $$;
commit;
notify pgrst, 'reload schema';
