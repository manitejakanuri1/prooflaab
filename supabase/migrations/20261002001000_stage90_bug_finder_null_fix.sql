-- 39: admin_bug_finder_runs returned NULL for failed_steps on a clean run (array_agg with no matching
-- rows is NULL, not '{}') - the admin page called .length on it and crashed. Wrap in coalesce.
begin;
create or replace function public.admin_bug_finder_runs(_limit integer default 20)
returns table (run_id uuid, started_at timestamptz, passed integer, total integer, failed_steps text[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.is_admin(), false) then raise exception 'admins only'; end if;
  return query
  select r.run_id, min(r.created_at), count(*) filter (where r.ok)::int, count(*)::int,
         coalesce(array_remove(array_agg(r.step order by r.created_at) filter (where not r.ok), null), array[]::text[])
    from public.bug_finder_runs r
   group by r.run_id
   order by min(r.created_at) desc
   limit greatest(1, least(_limit, 200));
end $$;
revoke all on function public.admin_bug_finder_runs(integer) from public, anon;
grant execute on function public.admin_bug_finder_runs(integer) to authenticated, service_role;
commit;
notify pgrst, 'reload schema';
