-- 168 (MF-023 + owner rule, 30 Oct 2026): who sees a student's finished work.
--   Admin and the student's own college: always everything - code / written answer, voice words, the recording.
--   A company: only when the student's ONE switch is on ("Companies can see my profile and all my work" =
--   student_portfolios.is_public, off by default), and then all finished work too - never weak areas.
--   Before: a company needed BOTH profile_visibility = 'public' (on for everyone by default) AND is_public, so only
--   4 of 62 TEST students were findable; audio needed a third switch (share_voice_audio). Both are ignored now.
--   The 4 students who had switched on agreed to less (no code, maybe no audio): their switch is set OFF so they
--   choose again (owner decision (b)).
-- Rollback: migration/168-rollback-work-visibility.sql (restores the bodies; the 4 switches are NOT turned back on).
begin;

-- The one switch.
create or replace function public.student_is_discoverable(_student_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select exists (
    select 1
      from public.student_profiles p
      join public.student_portfolios f on f.student_id = p.id
     where p.id = _student_id
       and p.status = 'active'
       and f.is_public = true);
$fn$;

-- Every finished task of a student with the answer and the voice: the passed check, else the best, newest on a tie.
-- Server-side only; tpo_student_work (admin / own college) and recruiter_proof_profile (switch on) call it.
create or replace function public.student_work(_student_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(jsonb_agg(to_jsonb(w) order by w.submitted_at desc), '[]'::jsonb) from (
    select distinct on (s.task_id)
           s.task_id, t.title,
           case when s.sandbox_config_id is not null then 'code' else 'written' end as kind,
           s.language, s.code as answer, s.passed_count, s.total_count, s.sandbox_score as score,
           s.status, s.created_at as submitted_at,
           (select count(*) from public.task_submissions x where x.student_id = _student_id and x.task_id = s.task_id) as attempts,
           (select jsonb_build_object('id', v.id, 'score', v.communication_score, 'words', v.transcript,
                                      'has_audio', v.storage_path is not null and v.audio_purged_at is null)
              from public.voice_explanations v
             where v.task_id = s.task_id and v.student_id = _student_id and v.status = 'scored' and v.withdrawn_at is null
             order by v.current_authoritative desc, v.created_at limit 1) as voice
      from public.task_submissions s
      join public.tasks t on t.id = s.task_id
     where s.student_id = _student_id
       and (exists (select 1 from public.task_submissions p2
                     where p2.task_id = s.task_id and p2.student_id = _student_id and p2.status = 'passed')
            or t.status in ('pending_voice', 'completed', 'Completed'))
     order by s.task_id, (s.status = 'passed') desc,
              case when s.total_count > 0 then s.passed_count::numeric / s.total_count
                   else coalesce(s.sandbox_score, 0) / 100.0 end desc,
              s.created_at desc
     limit 100
  ) w;
$fn$;
revoke all on function public.student_work(uuid) from public, anon, authenticated;
grant execute on function public.student_work(uuid) to service_role;

-- College and admin: all finished work of one student (same check as tpo_student_profile).
create or replace function public.tpo_student_work(_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare cid uuid := public.my_college_id(); sc uuid;
begin
  select college_id into sc from public.student_profiles where id = _student_id;
  if not ((cid is not null and sc is not null and sc = cid) or coalesce(public.is_admin(), false)) then
    return jsonb_build_object('error', 'that student is not at your college');
  end if;
  return jsonb_build_object('work', public.student_work(_student_id));
end $fn$;
revoke all on function public.tpo_student_work(uuid) from public, anon;
grant execute on function public.tpo_student_work(uuid) to authenticated;

-- One recording's file path for the caller (the voice-play function streams it; the browser never gets a link).
--   admin, or the student's own college: always.  a verified company: scored, server-transcribed, current, and the
--   student's one switch on (no second audio switch since 168).  Every play is written to security_events.
-- (_company is the caller; the name stays because CREATE OR REPLACE cannot rename a parameter.)
create or replace function public.company_voice_recording(_company uuid, _voice_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $fn$
declare path text; sid uuid; staff boolean;
begin
  select ve.storage_path, ve.student_id into path, sid
    from public.voice_explanations ve
   where ve.id = _voice_id and ve.withdrawn_at is null and ve.storage_path is not null;
  if path is null then return null; end if;
  staff := public.has_role(_company, 'admin')
        or exists (select 1 from public.colleges c join public.student_profiles p on p.college_id = c.id
                    where c.user_id = _company and c.verification_status = 'approved' and p.id = sid);
  if not staff and not exists (
       select 1 from public.voice_explanations ve join public.recruiters r on r.id = _company and r.verified
        where ve.id = _voice_id and ve.communication_score is not null and ve.transcript_source = 'server'
          and ve.status = 'scored' and ve.current_authoritative
          and public.student_is_discoverable(ve.student_id)) then
    return null;
  end if;
  insert into public.security_events (event_type, severity, source, user_id, detail)
  values (case when staff then 'staff_voice_played' else 'company_voice_played' end, 'info', 'server', _company,
          jsonb_build_object('voice_id', _voice_id, 'student_id', sid));
  return path;
end $fn$;

CREATE OR REPLACE FUNCTION public.recruiter_proof_profile(_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p record; rid uuid := public.my_recruiter_id(); accepted boolean;
begin
  if not public.is_verified_recruiter() then
    return jsonb_build_object('error', 'Your recruiter account is awaiting verification.');
  end if;
  if not public.student_is_discoverable(_student_id) then
    return jsonb_build_object('error', 'No candidate found.');
  end if;
  select * into p from public.student_profiles where id = _student_id;
  select sl.student_response = 'accepted' into accepted
    from public.recruiter_shortlists sl
   where sl.recruiter_id = rid and sl.student_id = _student_id;
  return jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'branch', p.branch,
    'batch', p.batch,
    'year_of_study', p.year_of_study,
    'target_role', p.target_role,
    'secondary_roles', p.secondary_roles,
    'work_preference', p.work_preference,
    'preferred_locations', p.preferred_locations,
    'open_to_relocate', p.open_to_relocate,
    'total_xp', p.total_xp,
    'last_active', p.last_active,
    'days_since_active', case when p.last_active is null then 999
                              else (current_date - p.last_active::date) end,
    'contact_unlocked', coalesce(accepted, false),
    'contact', case when coalesce(accepted, false) then
        (select jsonb_build_object('email', c.email, 'phone', c.phone,
                                   'github', c.github_url, 'linkedin', c.linkedin_url)
           from public.student_contact c where c.student_id = p.id)
      else null end,
    'skills', (select coalesce(jsonb_agg(jsonb_build_object(
                 'skill', s.skill, 'status', s.status, 'score', s.assessed_score,
                 'lots', s.proven_lots, 'explanations', s.proven_voice,
                 'last_evidence_at', s.last_evidence_at)
                 order by array_position(array['proven','assessed','claimed','needs_improvement'],
                                         s.status), s.skill), '[]'::jsonb)
                 from public.student_skills s
                where s.student_id = p.id and s.status is distinct from 'needs_improvement'),
    'certifications', (select coalesce(jsonb_agg(jsonb_build_object(
                         'name', t.name, 'issuer', t.issuer, 'issued_on', t.issued_on,
                         'url', t.credential_url, 'source', t.source)
                         order by t.issued_on desc nulls last), '[]'::jsonb)
                         from public.student_certifications t where t.student_id = p.id),
    'scorecard', (select jsonb_build_object(
                    'resume_quality', s.resume_quality_score,
                    'ats_match', s.ats_match_score,
                    'skill_proof', s.skill_proof_score,
                    'project_proof', s.project_proof_score,
                    'reasoning', s.reasoning_score,
                    'coding', s.coding_score,
                    'interview_readiness', s.interview_readiness_score,
                    'at', s.created_at)
                    from public.resume_scorecards s
                   where s.student_id = p.id order by s.created_at desc limit 1),
    -- Lots this student passed (latest passing attempt per Lot). Status and score only - no code.
    'work', (select coalesce(jsonb_agg(w order by w.submitted_at desc), '[]'::jsonb) from (
        select s.id, 'Verified'::text as status, s.sandbox_score as ai_score, s.created_at as submitted_at,
               t.title, t.difficulty
          from public.task_submissions s
          join public.tasks t on t.id = s.task_id
         where s.student_id = p.id and s.status = 'passed' and t.source = 'daily_lot'
           and s.created_at = (select max(l.created_at) from public.task_submissions l
                                where l.task_id = s.task_id and l.student_id = s.student_id and l.status = 'passed')
         order by s.created_at desc limit 10) w),
    -- Only the authoritative, server-transcribed, scored explanation of a submission
    -- (migration 61) is ever shown to a company. This replaces the on-hold migration 46.
    'explanations', (select coalesce(jsonb_agg(v order by v.created_at desc), '[]'::jsonb) from (
        select ve.id, ve.duration_seconds, ve.communication_score,
               ve.created_at, (ve.withdrawn_at is null and ve.storage_path is not null) as audio_shared,
               ve.transcript,
               (select t.title from public.tasks t where t.id = ve.task_id) as about
          from public.voice_explanations ve
         where ve.student_id = p.id and ve.communication_score >= 50
           and exists (select 1 from public.tasks dl where dl.id = ve.task_id and dl.source = 'daily_lot')
           and ve.transcript_source = 'server'
           and ve.status = 'scored' and ve.current_authoritative and ve.withdrawn_at is null
         order by ve.created_at desc limit 5) v),
    -- 168: with the one switch on, a company sees all finished work: the answer and the voice words (never weak areas).
    'answers', public.student_work(p.id),
    'communication', (select round(avg(v.communication_score))::integer
                        from public.voice_explanations v
                       where v.student_id = p.id and v.communication_score is not null
                         and exists (select 1 from public.tasks dl where dl.id = v.task_id and dl.source = 'daily_lot')
                         and v.transcript_source = 'server'
                         and v.status = 'scored' and v.current_authoritative and v.withdrawn_at is null),
    'consistency', jsonb_build_object(
      'active_weeks', (select count(*) from public.student_weekly_scores w
                        where w.student_id = p.id and w.points > 0),
      'weeks_total',  (select count(distinct w.week) from public.student_weekly_scores w
                        where w.student_id = p.id),
      'current_streak', (select current_days from public.student_streaks st
                          where st.student_id = p.id),
      'lots_done', (select count(*) from public.tasks t
                     where t.student_id = p.id and t.status in ('Completed','completed'))),
    'squad', (select jsonb_build_object(
                'name', q.name, 'rank', q.rank, 'points', q.points,
                'record', q.wins || '-' || q.draws || '-' || q.losses,
                'contribution', m.contribution)
                from public.squad_members m
                join public.squads q on q.id = m.squad_id
               where m.student_id = p.id and m.left_at is null limit 1),
    'ladder', jsonb_build_object(
      'track', (select t.track_slug from public.student_tracks t
                 where t.student_id = p.id order by t.created_at desc limit 1),
      'cleared', (select count(*) from public.student_levels sl
                   where sl.student_id = p.id and sl.status in ('cleared','mastered'))),
    'shortlist', (select jsonb_build_object('stage', sl.stage,
                          'response', sl.student_response, 'note', sl.note)
                    from public.recruiter_shortlists sl
                   where sl.recruiter_id = rid and sl.student_id = p.id)
  );
end $function$;

-- The 4 students who switched on under the old meaning choose again.
update public.student_portfolios set is_public = false where is_public;

do $$
begin
  if pg_get_functiondef('public.student_is_discoverable(uuid)'::regprocedure) ~ 'profile_visibility'
     or pg_get_functiondef('public.company_voice_recording(uuid,uuid)'::regprocedure) ~ 'share_voice_audio' then
    raise exception '168: a second switch still gates companies';
  end if;
  if has_function_privilege('authenticated', 'public.student_work(uuid)', 'execute') then
    raise exception '168: student_work is open to the browser';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
