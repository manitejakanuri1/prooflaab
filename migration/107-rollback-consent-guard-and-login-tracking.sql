-- 107 rollback: removes the consent guard, the protected-notice list and the login-id clean-up.
-- After this an administrator can again switch a student's audio sharing on, so every student is switched off
-- first. Kept on purpose: columns removed_students.login_deleted_at and login_delete_attempts, and the login id
-- in the self-deletion record (removing it would only stop pending login deletions from being finished).
begin;

update public.student_profiles set share_voice_audio = false where share_voice_audio;
drop trigger if exists student_profiles_guard_share_voice_audio on public.student_profiles;
drop function if exists public.guard_share_voice_audio();
drop trigger if exists removed_students_forget_login_id on public.removed_students;
drop function if exists public.removed_students_forget_login_id();

-- migration 105's bodies, verbatim
create or replace function public.set_share_voice_audio(_on boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.student_profiles set share_voice_audio = _on where id = auth.uid();
  if not found then
    raise exception 'only a student can change this' using errcode = '42501';
  end if;
  insert into public.security_events (event_type, severity, source, user_id, detail)
  values ('voice_audio_sharing_changed', 'info', 'server', auth.uid(), jsonb_build_object('enabled', _on));
end $$;

create or replace function public.apply_notification_rules()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.notification_rules r where r.type = new.type and not r.enabled) then
    return null;  -- switched off by an administrator: the notification is not created
  end if;
  return new;
end $$;

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

drop function if exists public.notification_type_protected(text);

commit;
notify pgrst, 'reload schema';
