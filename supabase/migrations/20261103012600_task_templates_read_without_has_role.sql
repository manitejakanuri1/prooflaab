-- 136: admins and colleges can read task templates again.
--
-- WHY. Found on staging 23 Oct 2026: Admin -> Work -> Assign tasks answered 403 "permission denied for
-- function has_role". has_role() is (rightly) callable only by the server, but the read rule on
-- task_templates still called has_role(created_by, 'admin'), so the read failed for everyone signed in.
-- NOW. template_made_by_admin(uuid) answers only that one question (was this template made by an admin)
-- and may be called by signed-in users; the read rule uses it. Who may read which template is unchanged.
-- Rollback: migration/136-rollback-task-templates-read-without-has-role.sql
begin;
create or replace function public.template_made_by_admin(_created_by uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select exists (select 1 from public.user_roles where user_id = _created_by and role = 'admin');
$function$;
revoke all on function public.template_made_by_admin(uuid) from public, anon;
grant execute on function public.template_made_by_admin(uuid) to authenticated, service_role;

drop policy if exists task_templates_read on public.task_templates;
create policy task_templates_read on public.task_templates for select
  using ((select public.is_admin())
         or ((select public.my_college_id()) is not null
             and (created_by is null or created_by = (select auth.uid()) or public.template_made_by_admin(created_by))));

do $$ begin
  if exists (select 1 from pg_policy where polrelid = 'public.task_templates'::regclass
              and pg_get_expr(polqual, polrelid) ilike '%has_role%') then
    raise exception '136: the read rule still calls has_role';
  end if;
  if has_function_privilege('authenticated', 'public.has_role(uuid,app_role)', 'EXECUTE') then
    raise exception '136: has_role must stay server-only';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
