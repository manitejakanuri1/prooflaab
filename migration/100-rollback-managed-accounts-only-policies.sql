-- Rollback for 100: puts the three self-service INSERT policies back exactly as they were
-- (stage 47, stage 14, stage 1). NOT APPLIED ANYWHERE.
--
-- Running this re-opens the gap 100 closes. Use it only if a legitimate flow turns out to
-- depend on one of them, and only for as long as it takes to move that flow to the server.
begin;

drop policy if exists user_roles_self_claim on public.user_roles;
create policy user_roles_self_claim on public.user_roles
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = any (array[
      'student'::app_role,
      'college_admin'::app_role,
      'startup'::app_role,
      'recruiter'::app_role
    ])
  );

drop policy if exists startups_self_signup on public.startups;
create policy startups_self_signup on public.startups for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists colleges_admin_insert on public.colleges;
drop policy if exists colleges_own_insert on public.colleges;
create policy colleges_own_insert on public.colleges
  for insert to authenticated with check (user_id = (select auth.uid()) or public.is_admin());

commit;

notify pgrst, 'reload schema';
