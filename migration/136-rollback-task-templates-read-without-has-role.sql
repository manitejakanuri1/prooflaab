-- ROLLBACK for 136: the read rule calls has_role() again (and fails for signed-in users, as before 136).
begin;
drop policy if exists task_templates_read on public.task_templates;
create policy task_templates_read on public.task_templates for select
  using ((select public.is_admin())
         or ((select public.my_college_id()) is not null
             and (created_by is null or created_by = (select auth.uid()) or public.has_role(created_by, 'admin'::app_role))));
drop function if exists public.template_made_by_admin(uuid);
commit;
notify pgrst, 'reload schema';
