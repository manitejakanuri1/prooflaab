-- 106: repairs and hardens migration 105 (S34 release preparation). Requires 105 and 65.
--
--   1. REPAIR. Migration 105 rebuilt remove_students() from migration 17's body instead of migration 65's, the
--      current one. That brought back a read of the retired proof-upload table and dropped the student's graded
--      submissions from the removal backup. This puts migration 65's body back, with the 'self' reason added.
--   2. A self-removal now keeps the login id (needed to finish deleting the login if the first attempt fails)
--      instead of a list of voice files; every file is found by the student's id. login_deleted_at records when
--      the login was confirmed gone.
--   3. Consent. student_profiles lets an administrator update any row, so an administrator (or the backend) could
--      switch a student's "let companies listen" on. A trigger now allows ON only for the student themself.
--      Anyone who may edit the row may switch it OFF.
-- Rollback: 106-rollback-live-controls-repair.sql.
begin;

alter table public.removed_students add column if not exists login_deleted_at timestamptz;
grant update (files_purged_at, login_deleted_at) on table public.removed_students to service_role;

CREATE OR REPLACE FUNCTION public.remove_students(_ids uuid[], _by uuid, _reason text)
 RETURNS TABLE(student_id uuid, provider_uid text, email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
  -- A person may remove exactly one account this way: their own.
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
      -- A self-removal keeps no copy of the work: only what is needed to finish deleting the login.
      case when _reason = 'self' then jsonb_build_object('self_requested', true, 'provider_uid', s.provider_uid)
      else jsonb_build_object(
      'profile',     (select to_jsonb(p) from public.student_profiles p where p.id = s.student_id),
      'contact',     (select to_jsonb(c) from public.student_contact c where c.student_id = s.student_id),
      'provider_uid', s.provider_uid,
      'squad',       (select jsonb_agg(to_jsonb(m)) from public.squad_members m where m.student_id = s.student_id),
      'tasks',       (select jsonb_agg(to_jsonb(t)) from public.tasks t where t.student_id = s.student_id),
      -- The student's graded work. (This backup used to keep proof uploads only, so a
      -- removed student's real submissions were not in it.)
      'submissions', (select jsonb_agg(to_jsonb(x)) from public.task_submissions x where x.student_id = s.student_id),
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
$function$;

revoke all on function public.remove_students(uuid[], uuid, text) from public, anon, authenticated;
grant execute on function public.remove_students(uuid[], uuid, text) to service_role;

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

do $$
declare def text := pg_get_functiondef('public.remove_students(uuid[], uuid, text)'::regprocedure);
begin
  if position('task_submissions' in def) = 0 or position('proof_' || 'uploads' in def) > 0 then
    raise exception '106 self-check: remove_students is not built on the current (migration 65) body';
  end if;
  if position('self_requested' in def) = 0 then
    raise exception '106 self-check: remove_students has no self reason';
  end if;
  if has_function_privilege('authenticated', 'public.remove_students(uuid[], uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.remove_students(uuid[], uuid, text)', 'execute') then
    raise exception '106 self-check: remove_students grants wrong';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'student_profiles_guard_share_voice_audio' and not tgisinternal) then
    raise exception '106 self-check: the consent guard trigger is missing';
  end if;
  if to_regprocedure('public.company_voice_recording(uuid, uuid)') is null then
    raise exception '106 self-check: requires migration 105';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
