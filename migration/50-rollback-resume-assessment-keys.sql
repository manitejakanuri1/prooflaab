-- Rollback of 50: restores the pre-50 access exactly as the Supabase-era schema had it
-- (FOR ALL own-row policy, table-wide grants). Re-opens N20; use only to undo a bad deploy.
begin;
drop policy if exists resume_assessments_own_select on public.resume_assessments;
drop policy if exists resume_assessments_own_all on public.resume_assessments;
create policy resume_assessments_own_all on public.resume_assessments
  for all to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());
grant all on public.resume_assessments to anon, authenticated, service_role;
do $$
begin
  if not has_table_privilege('authenticated', 'public.resume_assessments', 'UPDATE') then
    raise exception 'rollback did not restore the old grants';
  end if;
  raise notice '50 rolled back';
end $$;
commit;
notify pgrst, 'reload schema';
