-- 107: hardening for the S34 controls. Requires 105 and 106 (106 repairs remove_students; this does not).
--
--   1. Consent. student_profiles lets an administrator update any row, so an administrator (or the backend) could
--      switch a student's "let companies listen" on. A trigger now allows ON only for the student themself.
--      Anyone who may edit the row may switch it OFF.
--   2. Self-deletion. The removal record of a self-deleted student now also keeps the login id, so the accounts
--      service can finish deleting a login whose first deletion failed (login_deleted_at says when it was
--      confirmed gone). One anchored addition in the LIVE remove_students() definition, refused unless found
--      exactly once; nothing else in the function changes (checked below).
--   3. Notification rules. The notices a person needs in order to act cannot be switched off:
--      review_outcome, sponsored_task, college_linked. (Sidhu S34 QA, P2.)
-- Rollback: 107-rollback-consent-guard-and-login-tracking.sql.
begin;

-- ── 1. consent guard ────────────────────────────────────────────────────────
create or replace function public.guard_share_voice_audio()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.share_voice_audio
     and (tg_op = 'INSERT' or not old.share_voice_audio)
     and (select auth.uid()) is distinct from new.id then
    raise exception 'only the student can allow companies to listen' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists student_profiles_guard_share_voice_audio on public.student_profiles;
create trigger student_profiles_guard_share_voice_audio
  before insert or update of share_voice_audio on public.student_profiles
  for each row execute function public.guard_share_voice_audio();
revoke all on function public.guard_share_voice_audio() from public, anon, authenticated;

-- ── 2. finish a login deletion later ────────────────────────────────────────
alter table public.removed_students add column if not exists login_deleted_at timestamptz;
grant update (files_purged_at, login_deleted_at) on table public.removed_students to service_role;

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
create or replace function public.admin_set_notification_rule(_type text, _enabled boolean)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'only an administrator can change notification rules' using errcode = '42501';
  end if;
  if not _enabled and _type in ('review_outcome', 'sponsored_task', 'college_linked') then
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
 where not enabled and type in ('review_outcome', 'sponsored_task', 'college_linked');

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
  if not exists (select 1 from pg_trigger where tgname = 'student_profiles_guard_share_voice_audio' and not tgisinternal) then
    raise exception '107 self-check: the consent guard trigger is missing';
  end if;
  if has_function_privilege('anon', 'public.admin_set_notification_rule(text, boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_set_notification_rule(text, boolean)', 'execute') then
    raise exception '107 self-check: admin_set_notification_rule privileges changed';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
