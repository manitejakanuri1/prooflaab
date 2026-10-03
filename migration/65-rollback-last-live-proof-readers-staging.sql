-- Rollback of 65 FOR STAGING: restores record_activity and remove_students as they were on
-- staging. guard_voice_explanations_insert: re-apply its definition from migration 43.
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
  select (select count(*) from public.proof_uploads
           where student_id = _student_id and status = 'Verified')
       + (select count(*) from public.task_submissions
           where student_id = _student_id and status = 'passed')
    into proofs;
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
$function$;

commit;
