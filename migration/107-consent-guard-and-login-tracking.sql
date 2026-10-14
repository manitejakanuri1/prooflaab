-- 107: hardening for the S34 controls. Requires 105 and 106 (106 repairs remove_students; this does not).
-- Includes the fixes for Sidhu's S36 security QA findings S36-03, S36-04, S36-05 and S36-06.
--
--   1. Consent. student_profiles lets an administrator update any row, so an administrator (or the backend) could
--      switch a student's "let companies listen" on. A trigger now allows ON only for the student themself.
--      Anyone who may edit the row may switch it OFF. Every real change is written to security_events BY THE
--      TRIGGER, so a direct table write is recorded exactly like the function call (S36-03); the function no
--      longer writes its own record, so there is one record per change.
--   2. Self-deletion. The removal record of a self-deleted student also keeps the login id, so the accounts
--      service can finish deleting a login whose first deletion failed. login_deleted_at says when it was
--      confirmed gone, and at that moment the login id is removed from the record again (S36-05).
--      login_delete_attempts lets the retry take the least-tried rows first (S36-06). One anchored addition in
--      the LIVE remove_students() definition, refused unless found exactly once; nothing else in it changes.
--   3. Notification rules. The notices a person needs in order to act cannot be switched off:
--      review_outcome, sponsored_task, college_linked. The rule function refuses, AND the trigger that drops
--      switched-off notices never drops these, whatever the rules table says (S36-04).
-- Rollback: 107-rollback-consent-guard-and-login-tracking.sql.
begin;

-- ── 1. consent guard, with the audit record ─────────────────────────────────
create or replace function public.guard_share_voice_audio()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare was boolean := case when tg_op = 'INSERT' then false else coalesce(old.share_voice_audio, false) end;
begin
  if new.share_voice_audio is not distinct from was then
    return new;                                   -- nothing changed: nothing to check or record
  end if;
  if new.share_voice_audio and (select auth.uid()) is distinct from new.id then
    raise exception 'only the student can allow companies to listen' using errcode = '42501';
  end if;
  insert into public.security_events (event_type, severity, source, user_id, detail)
  values ('voice_audio_sharing_changed', 'info', 'server', (select auth.uid()),
          jsonb_build_object('enabled', new.share_voice_audio, 'student_id', new.id));
  return new;
end $$;
drop trigger if exists student_profiles_guard_share_voice_audio on public.student_profiles;
create trigger student_profiles_guard_share_voice_audio
  before insert or update of share_voice_audio on public.student_profiles
  for each row execute function public.guard_share_voice_audio();
revoke all on function public.guard_share_voice_audio() from public, anon, authenticated;

-- The student's own switch. The trigger above writes the record.
create or replace function public.set_share_voice_audio(_on boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.student_profiles set share_voice_audio = _on where id = auth.uid();
  if not found then
    raise exception 'only a student can change this' using errcode = '42501';
  end if;
end $$;

-- ── 2. finish a login deletion later ────────────────────────────────────────
alter table public.removed_students add column if not exists login_deleted_at timestamptz;
alter table public.removed_students add column if not exists login_delete_attempts integer not null default 0;
grant update (files_purged_at, login_deleted_at, login_delete_attempts) on table public.removed_students to service_role;

-- The login id is kept only to delete the login. Once that is recorded, it goes.
create or replace function public.removed_students_forget_login_id()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.reason = 'self' and new.login_deleted_at is not null then
    new.snapshot := new.snapshot - 'provider_uid';
  end if;
  return new;
end $$;
drop trigger if exists removed_students_forget_login_id on public.removed_students;
create trigger removed_students_forget_login_id
  before update of login_deleted_at on public.removed_students
  for each row execute function public.removed_students_forget_login_id();
revoke all on function public.removed_students_forget_login_id() from public, anon, authenticated;

create temp table _107_before on commit drop as
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl
    from pg_proc p where p.oid = 'public.remove_students(uuid[],uuid,text)'::regprocedure;

do $$
declare
  anchor constant text := '''self_requested'', true,';
  def text := pg_get_functiondef('public.remove_students(uuid[],uuid,text)'::regprocedure);
  n int := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
begin
  if position('''provider_uid'', s.provider_uid, -- 107' in def) > 0 then
    raise notice '107: remove_students already keeps the login id for a self-deletion';
    return;
  end if;
  if n <> 1 then
    raise exception '107: expected the self-deletion entry exactly once in remove_students, found %', n;
  end if;
  execute replace(def, anchor, anchor || E'\n        ''provider_uid'', s.provider_uid, -- 107: to finish deleting the login');
end $$;

-- ── 3. notices that cannot be switched off ──────────────────────────────────
create or replace function public.notification_type_protected(_type text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select _type in ('review_outcome', 'sponsored_task', 'college_linked');
$$;
revoke all on function public.notification_type_protected(text) from public, anon, authenticated;
grant execute on function public.notification_type_protected(text) to service_role;

create or replace function public.apply_notification_rules()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.notification_type_protected(new.type)
     and exists (select 1 from public.notification_rules r where r.type = new.type and not r.enabled) then
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
  if not _enabled and public.notification_type_protected(_type) then
    raise exception 'this notification cannot be switched off: people need it to act' using errcode = '22023';
  end if;
  insert into public.notification_rules (type, enabled, updated_by)
  values (_type, _enabled, auth.uid())
  on conflict (type) do update
    set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
  insert into public.security_events (event_type, severity, source, user_id, detail)
  values ('notification_rule_changed', 'info', 'server', auth.uid(),
          jsonb_build_object('type', _type, 'enabled', _enabled));
end $$;
-- A rule saved before this migration must not keep a protected notice off.
update public.notification_rules set enabled = true, updated_at = now()
 where not enabled and public.notification_type_protected(type);

do $$
declare
  f constant regprocedure := 'public.remove_students(uuid[],uuid,text)'::regprocedure;
  def text := pg_get_functiondef(f); b record; a record;
begin
  select * into b from _107_before;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl into a from pg_proc p where p.oid = f;
  if a.proowner <> b.proowner or a.prosecdef <> b.prosecdef or a.proconfig is distinct from b.proconfig or a.acl is distinct from b.acl then
    raise exception '107 self-check: remove_students changed more than its self-deletion entry';
  end if;
  if position('''provider_uid'', s.provider_uid, -- 107' in def) = 0 then
    raise exception '107 self-check: the self-deletion record does not keep the login id';
  end if;
  if position('task_submissions' in def) = 0 or position('proof_' || 'uploads' in def) > 0 then
    raise exception '107 self-check: requires migration 106 (remove_students still reads the retired table)';
  end if;
  if has_function_privilege('authenticated', f, 'execute') or not has_function_privilege('service_role', f, 'execute') then
    raise exception '107 self-check: remove_students privileges wrong';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'student_profiles_guard_share_voice_audio' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgname = 'removed_students_forget_login_id' and not tgisinternal) then
    raise exception '107 self-check: a trigger is missing';
  end if;
  if has_function_privilege('anon', 'public.admin_set_notification_rule(text, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_set_notification_rule(text, boolean)', 'execute')
     or has_function_privilege('anon', 'public.set_share_voice_audio(boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_share_voice_audio(boolean)', 'execute') then
    raise exception '107 self-check: a browser function has the wrong privileges';
  end if;
  if has_function_privilege('authenticated', 'public.notification_type_protected(text)', 'execute') then
    raise exception '107 self-check: an internal function is callable by the browser role';
  end if;
  if has_table_privilege('authenticated', 'public.removed_students', 'select')
     or has_table_privilege('anon', 'public.removed_students', 'select') then
    raise exception '107 self-check: removed_students is readable by a browser role';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
