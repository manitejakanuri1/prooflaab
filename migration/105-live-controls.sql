-- 105: the four dashboard controls that had no action behind them (S34).
-- Requires 17 (remove_students), 61 (voice bound to submission), 104.
--
--   1. Student "Delete Account": remove_students() accepts the reason 'self', and only for the caller's own
--      account. A self-removal keeps NO copy of the student's work: the record holds who and when. The daily
--      job deletes every file in the student's own folders (files_purged_at); the accounts service finishes
--      deleting the login if the first attempt failed (login_deleted_at).
--   2. Admin "Email Templates": email_templates holds the subject and opening paragraph of each welcome email.
--      send-onboarding-email reads it; with no row the built-in wording is used. Plain text only.
--   3. Admin "Notification Rules": notification_rules switches one notification type off. A trigger on
--      notifications drops a new row whose type is switched off. No row = on, so nothing changes until an
--      admin switches something off.
--   4. Company "Voice Play": student_profiles.share_voice_audio (off by default) is the student's consent.
--      company_voice_recording() answers the file path only to a verified company, for a discoverable student
--      who switched it on, for a recording that is not withdrawn, and writes who listened to what.
-- Every change an admin makes, and every listen, is written to security_events.
-- Rollback: 105-rollback-live-controls.sql.
begin;

-- ── 1. delete my own account ────────────────────────────────────────────────
alter table public.removed_students drop constraint if exists removed_students_reason_check;
alter table public.removed_students add constraint removed_students_reason_check
  check (reason in ('college', 'admin', 'console_sync', 'self'));
alter table public.removed_students add column if not exists files_purged_at timestamptz;
-- When the Google login was confirmed gone. Empty on a 'self' row = the login is disabled and still to be deleted;
-- the accounts service retries it on every sync run.
alter table public.removed_students add column if not exists login_deleted_at timestamptz;
grant update (files_purged_at, login_deleted_at) on table public.removed_students to service_role;

create or replace function public.remove_students(_ids uuid[], _by uuid, _reason text)
returns table (student_id uuid, provider_uid text, email text)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
#variable_conflict use_column
declare
  is_admin boolean := exists (select 1 from public.user_roles where user_id = _by and role = 'admin');
  my_college uuid := (select id from public.colleges where user_id = _by limit 1);
  s record;
begin
  if _reason not in ('college', 'admin', 'console_sync', 'self') then
    raise exception 'unknown reason %', _reason;
  end if;
  if _by is null and _reason <> 'console_sync' then
    raise exception 'only the console sync may remove without a person';
  end if;
  -- 105: a person may remove exactly one account this way: their own.
  if _reason = 'self' and (_ids is null or _ids <> array[_by]) then
    raise exception 'you can delete only your own account';
  end if;
  if _reason <> 'self' and _by is not null and not is_admin and my_college is null then
    raise exception 'only a college or an administrator can remove students';
  end if;

  for s in
    select l.student_id, l.provider_uid, l.email, p.full_name, p.college_id
      from public.student_logins() l
      join public.student_profiles p on p.id = l.student_id
     where l.student_id = any(_ids)
  loop
    if _reason <> 'self' and _by is not null and not is_admin and s.college_id is distinct from my_college then
      raise exception 'that student belongs to another college';
    end if;

    insert into public.removed_students (student_id, college_id, email, full_name, removed_by, reason, snapshot)
    values (s.student_id, s.college_id, s.email, s.full_name, _by, _reason,
      case when _reason = 'self' then jsonb_build_object(
        'self_requested', true,
        'provider_uid', s.provider_uid)  -- needed to finish deleting the login; files are found by student_id
      else jsonb_build_object(
        'profile',     (select to_jsonb(p) from public.student_profiles p where p.id = s.student_id),
        'contact',     (select to_jsonb(c) from public.student_contact c where c.student_id = s.student_id),
        'provider_uid', s.provider_uid,
        'squad',       (select jsonb_agg(to_jsonb(m)) from public.squad_members m where m.student_id = s.student_id),
        'tasks',       (select jsonb_agg(to_jsonb(t)) from public.tasks t where t.student_id = s.student_id),
        'proofs',      (select jsonb_agg(to_jsonb(x)) from public.proof_uploads x where x.student_id = s.student_id),
        'scorecards',  (select jsonb_agg(to_jsonb(x)) from public.resume_scorecards x where x.student_id = s.student_id),
        'tracks',      (select jsonb_agg(to_jsonb(x)) from public.student_tracks x where x.student_id = s.student_id),
        'levels',      (select jsonb_agg(to_jsonb(x)) from public.student_levels x where x.student_id = s.student_id),
        'voice',       (select jsonb_agg(to_jsonb(x)) from public.voice_explanations x where x.student_id = s.student_id)
      ) end);

    delete from public.account_identities where user_id = s.student_id;
    delete from public.student_intake    where user_id = s.student_id;
    delete from auth.users               where id      = s.student_id;  -- everything else cascades

    student_id := s.student_id; provider_uid := s.provider_uid; email := s.email;
    return next;
  end loop;
end;
$$;
revoke all on function public.remove_students(uuid[], uuid, text) from public, anon, authenticated;
grant execute on function public.remove_students(uuid[], uuid, text) to service_role;

-- ── 2. email templates ──────────────────────────────────────────────────────
create table if not exists public.email_templates (
  key        text primary key check (key in ('student', 'college', 'startup', 'admin', 'general')),
  subject    text not null check (length(btrim(subject)) between 3 and 150),
  intro      text not null check (length(btrim(intro)) between 10 and 1000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.email_templates enable row level security;
revoke all on table public.email_templates from public, anon, authenticated;
grant select on table public.email_templates to service_role;

create or replace function public.admin_email_templates()
returns setof public.email_templates
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'only an administrator can read email templates' using errcode = '42501';
  end if;
  return query select * from public.email_templates order by key;
end $$;

-- An empty subject and intro puts the built-in wording back.
create or replace function public.admin_save_email_template(_key text, _subject text, _intro text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'only an administrator can change email templates' using errcode = '42501';
  end if;
  if coalesce(btrim(_subject), '') = '' and coalesce(btrim(_intro), '') = '' then
    delete from public.email_templates where key = _key;
  else
    insert into public.email_templates (key, subject, intro, updated_by)
    values (_key, btrim(_subject), btrim(_intro), auth.uid())
    on conflict (key) do update
      set subject = excluded.subject, intro = excluded.intro, updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.security_events (event_type, severity, source, user_id, detail)
  values ('email_template_changed', 'info', 'server', auth.uid(), jsonb_build_object('key', _key));
end $$;

-- ── 3. notification rules ───────────────────────────────────────────────────
create table if not exists public.notification_rules (
  type       text primary key check (type ~ '^[a-z0-9_]{1,60}$'),
  enabled    boolean not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.notification_rules enable row level security;
revoke all on table public.notification_rules from public, anon, authenticated;

create or replace function public.apply_notification_rules()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.notification_rules r where r.type = new.type and not r.enabled) then
    return null;  -- switched off by an administrator: the notification is not created
  end if;
  return new;
end $$;
drop trigger if exists notifications_apply_rules on public.notifications;
create trigger notifications_apply_rules before insert on public.notifications
  for each row execute function public.apply_notification_rules();

-- Every type the platform has sent in the last 90 days, plus every type with a rule.
create or replace function public.admin_notification_rules()
returns table (type text, enabled boolean, sent_90d bigint, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'only an administrator can read notification rules' using errcode = '42501';
  end if;
  return query
    select t.type, coalesce(r.enabled, true), coalesce(n.sent, 0), r.updated_at
      from (select n.type from public.notifications n where n.created_at > now() - interval '90 days'
            union select r.type from public.notification_rules r) t
      left join public.notification_rules r on r.type = t.type
      left join (select n.type, count(*) as sent from public.notifications n
                  where n.created_at > now() - interval '90 days' group by n.type) n on n.type = t.type
     order by t.type;
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

-- ── 4. a company listens to a recording ─────────────────────────────────────
alter table public.student_profiles add column if not exists share_voice_audio boolean not null default false;

-- Consent belongs to the student alone. student_profiles lets an administrator update any row, so without this
-- an administrator (or the backend) could switch a student's audio sharing on. Anyone may switch it OFF.
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

-- The student's own switch. A function, so every change is recorded.
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

-- Server only. The caller (the company-voice-play function) passes the signed-in company's id.
-- One answer for every refusal, so it cannot be used to find out who exists or who has recordings.
create or replace function public.company_voice_recording(_company uuid, _voice_id uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare path text; sid uuid;
begin
  select ve.storage_path, ve.student_id into path, sid
    from public.voice_explanations ve
    join public.student_profiles p on p.id = ve.student_id
    join public.recruiters r on r.id = _company and r.verified
   where ve.id = _voice_id
     and ve.withdrawn_at is null
     and ve.storage_path is not null
     and ve.communication_score is not null
     and ve.transcript_source = 'server'
     and ve.status = 'scored' and ve.current_authoritative
     and p.share_voice_audio
     and public.student_is_discoverable(ve.student_id);
  if path is null then
    return null;
  end if;
  insert into public.security_events (event_type, severity, source, user_id, detail)
  values ('company_voice_played', 'info', 'server', _company,
          jsonb_build_object('voice_id', _voice_id, 'student_id', sid));
  return path;
end $$;

-- The company profile says which recordings can be played. Migration 46's body, one anchored edit.
do $$
declare
  def text := pg_get_functiondef('public.recruiter_proof_profile(uuid)'::regprocedure);
  anchor text := 've.communication_notes, ve.created_at,';
begin
  if position('audio_shared' in def) = 0 then
    if position(anchor in def) = 0 then
      raise exception '105: recruiter_proof_profile is not the expected body';
    end if;
    execute replace(def, anchor, anchor || ' (p.share_voice_audio and ve.withdrawn_at is null and ve.storage_path is not null) as audio_shared,');
  end if;
end $$;

revoke all on function public.admin_email_templates()                        from public, anon;
revoke all on function public.admin_save_email_template(text, text, text)    from public, anon;
revoke all on function public.admin_notification_rules()                     from public, anon;
revoke all on function public.admin_set_notification_rule(text, boolean)     from public, anon;
revoke all on function public.set_share_voice_audio(boolean)                 from public, anon;
revoke all on function public.apply_notification_rules()                     from public, anon, authenticated;
revoke all on function public.guard_share_voice_audio()                      from public, anon, authenticated;
revoke all on function public.company_voice_recording(uuid, uuid)            from public, anon, authenticated;
grant execute on function public.admin_email_templates()                     to authenticated;
grant execute on function public.admin_save_email_template(text, text, text) to authenticated;
grant execute on function public.admin_notification_rules()                  to authenticated;
grant execute on function public.admin_set_notification_rule(text, boolean)  to authenticated;
grant execute on function public.set_share_voice_audio(boolean)              to authenticated;
grant execute on function public.company_voice_recording(uuid, uuid)         to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.company_voice_recording(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.set_share_voice_audio(boolean)', 'execute')
     or has_function_privilege('anon', 'public.admin_save_email_template(text, text, text)', 'execute')
     or has_function_privilege('anon', 'public.admin_set_notification_rule(text, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.remove_students(uuid[], uuid, text)', 'execute') then
    raise exception '105 self-check: a function is callable by a role that must not call it';
  end if;
  if not has_function_privilege('service_role', 'public.company_voice_recording(uuid, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.remove_students(uuid[], uuid, text)', 'execute') then
    raise exception '105 self-check: service_role cannot run the server functions';
  end if;
  if has_table_privilege('authenticated', 'public.email_templates', 'select')
     or has_table_privilege('authenticated', 'public.notification_rules', 'select') then
    raise exception '105 self-check: a settings table is readable by the browser role';
  end if;
  if position('audio_shared' in pg_get_functiondef('public.recruiter_proof_profile(uuid)'::regprocedure)) = 0 then
    raise exception '105 self-check: recruiter_proof_profile does not report audio_shared';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'notifications_apply_rules' and not tgisinternal) then
    raise exception '105 self-check: the notification rules trigger is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'student_profiles_guard_share_voice_audio' and not tgisinternal) then
    raise exception '105 self-check: the consent guard trigger is missing';
  end if;
  if exists (select 1 from public.student_profiles where share_voice_audio) then
    raise exception '105 self-check: audio sharing must start switched off for everyone';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
