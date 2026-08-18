-- ============================================================================
-- Stage 1 follow-up — close the four advisor warnings the first migration left.
--
-- Applied straight after 20260815000000. Zero ERRORs before and after; this
-- clears the WARNs that were actually ours to fix. The two that remain are
-- expected: is_admin must stay callable by signed-in users because the policies
-- call it, and leaked-password protection is a dashboard toggle only the owner
-- can flip.
-- ============================================================================

-- 1. Pin search_path on the two trigger functions. Without it the function body
--    resolves names through whatever search_path the caller happens to have.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end;
$$;

create or replace function public.student_profiles_sync_ids()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.id is null then new.id := coalesce(new.user_id, auth.uid()); end if;
  if new.user_id is null then new.user_id := new.id; end if;
  return new;
end;
$$;

-- 2. No policy calls has_role directly — only is_admin does, and that runs as
--    its owner so it needs no grant on the caller's behalf. Granting has_role
--    to signed-in users exposed a REST endpoint answering "is this *other*
--    person an admin?".
revoke execute on function public.has_role(uuid, public.app_role) from authenticated;

-- 3. A FOR ALL policy also covers SELECT, so any table with both a select policy
--    and a FOR ALL write policy was evaluating two policies on every read. Split
--    the write policies into the three commands they actually need.
drop policy if exists colleges_own_write on public.colleges;
create policy colleges_own_insert on public.colleges
  for insert to authenticated with check (user_id = (select auth.uid()) or public.is_admin());
create policy colleges_own_update on public.colleges
  for update to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());
create policy colleges_own_delete on public.colleges
  for delete to authenticated using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists user_roles_admin_write on public.user_roles;
create policy user_roles_admin_insert on public.user_roles
  for insert to authenticated with check (public.is_admin());
create policy user_roles_admin_update on public.user_roles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy user_roles_admin_delete on public.user_roles
  for delete to authenticated using (public.is_admin());

drop policy if exists student_contact_own_write on public.student_contact;
create policy student_contact_own_insert on public.student_contact
  for insert to authenticated with check (student_id = (select auth.uid()) or public.is_admin());
create policy student_contact_own_update on public.student_contact
  for update to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());
create policy student_contact_own_delete on public.student_contact
  for delete to authenticated using (student_id = (select auth.uid()) or public.is_admin());

drop policy if exists resume_scorecards_admin_write on public.resume_scorecards;
create policy resume_scorecards_admin_insert on public.resume_scorecards
  for insert to authenticated with check (public.is_admin());
create policy resume_scorecards_admin_update on public.resume_scorecards
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy resume_scorecards_admin_delete on public.resume_scorecards
  for delete to authenticated using (public.is_admin());
