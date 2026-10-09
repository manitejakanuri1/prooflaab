-- 105 rollback: switches the four controls off again without deleting anything an admin or student saved.
-- After this: a student cannot delete their own account (the accounts service answers "you can delete only..."
-- from the database refusal), notification rules stop applying, companies cannot play audio, and
-- send-onboarding-email uses its built-in wording (it tolerates the missing read).
-- Kept on purpose: tables email_templates and notification_rules, columns student_profiles.share_voice_audio and
-- removed_students.files_purged_at and login_deleted_at, and existing removed_students rows with the reason 'self'.
-- Deploy order: put the previous functions and accounts images back BEFORE running this.
begin;

create or replace function public.remove_students(_ids uuid[], _by uuid, _reason text)
returns table (student_id uuid, provider_uid text, email text)
language plpgsql security definer set search_path = public, auth, pg_temp as $$
#variable_conflict use_column
declare
  is_admin boolean := exists (select 1 from public.user_roles where user_id = _by and role = 'admin');
  my_college uuid := (select id from public.colleges where user_id = _by limit 1);
  s record;
begin
  if _reason not in ('college', 'admin', 'console_sync') then
    raise exception 'unknown reason %', _reason;
  end if;
  if _by is null and _reason <> 'console_sync' then
    raise exception 'only the console sync may remove without a person';
  end if;
  if _by is not null and not is_admin and my_college is null then
    raise exception 'only a college or an administrator can remove students';
  end if;

  for s in
    select l.student_id, l.provider_uid, l.email, p.full_name, p.college_id
      from public.student_logins() l
      join public.student_profiles p on p.id = l.student_id
     where l.student_id = any(_ids)
  loop
    if _by is not null and not is_admin and s.college_id is distinct from my_college then
      raise exception 'that student belongs to another college';
    end if;

    insert into public.removed_students (student_id, college_id, email, full_name, removed_by, reason, snapshot)
    values (s.student_id, s.college_id, s.email, s.full_name, _by, _reason, jsonb_build_object(
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
    ));

    delete from public.account_identities where user_id = s.student_id;
    delete from public.student_intake    where user_id = s.student_id;
    delete from auth.users               where id      = s.student_id;  -- everything else cascades

    student_id := s.student_id; provider_uid := s.provider_uid; email := s.email;
    return next;
  end loop;
end;
$$;

drop trigger if exists notifications_apply_rules on public.notifications;
drop function if exists public.apply_notification_rules();
drop function if exists public.admin_email_templates();
drop function if exists public.admin_save_email_template(text, text, text);
drop function if exists public.admin_notification_rules();
drop function if exists public.admin_set_notification_rule(text, boolean);
drop function if exists public.set_share_voice_audio(boolean);
drop trigger if exists student_profiles_guard_share_voice_audio on public.student_profiles;
drop function if exists public.guard_share_voice_audio();
-- With the guard gone nothing protects the consent column, so every student is switched off again.
update public.student_profiles set share_voice_audio = false where share_voice_audio;
drop function if exists public.company_voice_recording(uuid, uuid);
revoke select on table public.email_templates from service_role;

do $$
declare
  def text := pg_get_functiondef('public.recruiter_proof_profile(uuid)'::regprocedure);
  added text := ' (p.share_voice_audio and ve.withdrawn_at is null and ve.storage_path is not null) as audio_shared,';
begin
  if position(added in def) > 0 then
    execute replace(def, added, '');
  end if;
  if position('audio_shared' in pg_get_functiondef('public.recruiter_proof_profile(uuid)'::regprocedure)) > 0 then
    raise exception '105 rollback: recruiter_proof_profile still reports audio_shared';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
