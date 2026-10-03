-- 65: the last LIVE database code that reads the retired proof tables (Wave 8c, stage 1).
-- Nothing is dropped here; after this file no function that still runs in the product
-- reads proof_uploads.
--   record_activity                 - "proof" badges count passed submissions only.
--   remove_students                 - the removal backup keeps the student's task_submissions
--                                     (it kept proof uploads only, so real work was not backed up).
--   guard_voice_explanations_insert - no proof link; proof_id is always stored empty.
-- Still referencing the proof tables after this, on purpose (dropped with the tables in the
-- cleanup migration): activity_from_proof, on_proof_change, on_proof_reviewed,
-- proof_uploads_reject_sandbox (triggers ON proof_uploads), cosign_proof, cosignable_proofs,
-- my_cosigns, set_proof_publicity (no caller left in the app).
begin;

CREATE OR REPLACE FUNCTION public.record_activity(_student_id uuid, _metric text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  q record; b record; period date;
  have integer; topics integer; proofs integer; streak integer;
begin
  if _student_id is null then return; end if;
  perform set_config('app.system_write', 'on', true);
  perform public.touch_streak(_student_id);
  for q in select * from public.quests where is_active and metric = _metric loop
    period := case when q.cadence = 'daily'
                   then current_date
                   else date_trunc('week', current_date)::date end;
    insert into public.student_quests (student_id, quest_slug, period_start, progress)
    values (_student_id, q.slug, period, 1)
    on conflict (student_id, quest_slug, period_start) do update
      set progress = least(public.student_quests.progress + 1, q.target);
    update public.student_quests sq
       set completed_at = now()
     where sq.student_id = _student_id and sq.quest_slug = q.slug
       and sq.period_start = period and sq.progress >= q.target
       and sq.completed_at is null;
    if found then
      insert into public.xp_logs (student_id, xp_points, source)
      values (_student_id, q.xp_reward, 'quest:' || q.slug);
      update public.student_profiles set total_xp = total_xp + q.xp_reward
       where id = _student_id;
    end if;
  end loop;
  select count(*) into topics from public.student_levels
   where student_id = _student_id and status in ('cleared', 'mastered');
  -- "proof" badges count passed submissions (the proof-upload table is retired).
  select count(*) into proofs from public.task_submissions
   where student_id = _student_id and status = 'passed';
  select coalesce(current_days, 0) into streak from public.student_streaks
   where student_id = _student_id;
  for b in select * from public.badges loop
    have := case b.rule_kind
              when 'level'  then topics
              when 'proof'  then proofs
              when 'streak' then streak
              else 0 end;
    if b.rule_value is not null and have >= b.rule_value then
      insert into public.student_badges (student_id, badge_slug)
      values (_student_id, b.slug)
      on conflict (student_id, badge_slug) do nothing;
    end if;
  end loop;
  perform set_config('app.system_write', 'off', true);
end
$function$;

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
      -- The student's graded work. (This backup used to keep proof uploads only, so a
      -- removed student's real submissions were not in it.)
      'submissions', (select jsonb_agg(to_jsonb(x)) from public.task_submissions x where x.student_id = s.student_id),
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
$function$;

create or replace function public.guard_voice_explanations_insert()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  -- A recording belongs to a submission (migration 61); the proof link is retired.
  new.proof_id := null;
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.student_id = new.student_id
  ) then
    raise exception 'task_id does not belong to this student';
  end if;
  new.transcript_source := 'browser';
  new.status := 'recorded';
  new.communication_score := null;
  new.communication_notes := null;
  new.word_count := case
    when new.transcript is not null and length(trim(new.transcript)) > 0
    then array_length(regexp_split_to_array(trim(new.transcript), '\s+'), 1)
    else 0
  end;
  new.transcription_status := 'completed';
  new.transcription_idempotency_key := null;
  new.transcription_claimed_at := null;
  new.transcription_attempts := 0;
  new.transcription_error := null;
  new.transcription_lease_token := null;
  new.transcription_enqueued_at := null;
  new.transcription_reap_claimed_at := null;
  new.transcription_reap_attempts := 0;
  return new;
end $function$;

do $$
declare f text;
begin
  foreach f in array array['public.record_activity(uuid,text)', 'public.remove_students(uuid[],uuid,text)',
                           'public.guard_voice_explanations_insert()']
  loop
    if pg_get_functiondef(f::regprocedure) ~ 'from public\.proof_uploads' then
      raise exception '65 self-check: % still reads proof_uploads', f;
    end if;
  end loop;
  if pg_get_functiondef('public.remove_students(uuid[],uuid,text)'::regprocedure) !~ 'task_submissions' then
    raise exception '65 self-check: the removal backup does not keep submissions';
  end if;
end $$;

commit;
