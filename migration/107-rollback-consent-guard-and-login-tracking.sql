-- 107 rollback: removes the consent guard and the list of notices that cannot be switched off.
-- After this an administrator can again switch a student's audio sharing on, so every student is switched off
-- first. Kept on purpose: column removed_students.login_deleted_at, and the login id in the self-deletion record
-- (removing it would only stop pending login deletions from being finished).
begin;

update public.student_profiles set share_voice_audio = false where share_voice_audio;
drop trigger if exists student_profiles_guard_share_voice_audio on public.student_profiles;
drop function if exists public.guard_share_voice_audio();

-- migration 105's body, verbatim
create or replace function public.admin_set_notification_rule(_type text, _enabled boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'only an administrator can change notification rules' using errcode = '42501';
  end if;
  insert into public.notification_rules (type, enabled, updated_by)
  values (_type, _enabled, auth.uid())
  on conflict (type) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
  insert into public.security_events (event_type, severity, source, user_id, detail)
  values ('notification_rule_changed', 'info', 'server', auth.uid(),
          jsonb_build_object('type', _type, 'enabled', _enabled));
end $$;

commit;
notify pgrst, 'reload schema';
