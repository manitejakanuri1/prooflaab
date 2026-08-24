-- ============================================================================
-- Stage 33 — Phase 1 of the master flow: the steps the build had drifted from.
--
-- Nothing new invented. Five of the twenty-one steps in section 4 were working
-- differently from how the document describes them, and this closes that gap.
-- ============================================================================


-- ── steps 4 and 23: the student's voice is theirs ───────────────────────
-- The platform stores a recording of a student's voice, a transcript of it and
-- a judgement about how clearly they explain things. They were never asked,
-- and could not take it back: the resumes and profile-photos buckets both have
-- a delete policy for their owner, and this one never did.
alter table public.student_profiles
  add column if not exists voice_consent_at timestamptz;

create policy voice_own_delete on public.voice_explanations for delete to authenticated
  using (student_id = (select auth.uid()));

create policy "Students can delete their own voice explanation"
  on storage.objects for delete to authenticated
  using (bucket_id = 'voice-explanations'
         and (select auth.uid())::text = (storage.foldername(name))[1]);

-- Asked once, before the first recording, and remembered. coalesce keeps the
-- original timestamp: consent is when they first agreed, not when they last
-- opened the panel.
create or replace function public.accept_voice_consent()
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $fn$
declare me uuid := (select auth.uid()); stamp timestamptz;
begin
  if me is null then raise exception 'not signed in'; end if;
  update public.student_profiles
     set voice_consent_at = coalesce(voice_consent_at, now())
   where id = me
  returning voice_consent_at into stamp;
  return stamp;
end $fn$;

revoke all on function public.accept_voice_consent() from public, anon;
grant execute on function public.accept_voice_consent() to authenticated;


-- ── step 3: the phone number the CSV was always meant to carry ──────────
-- A required column in section 6 that had nowhere to land, and the reason the
-- WhatsApp channel could not be started.
alter table public.student_contact
  add column if not exists phone text;


-- ── step 6: "student receives the assigned squad" ───────────────────────
-- Until now the Squad tab simply changed, and a student learned they had a
-- team by happening to look at it.
create or replace function public.notify_squad_placement()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare squad_name text;
begin
  select name into squad_name from public.squads where id = new.squad_id;
  if squad_name is null then return null; end if;

  insert into public.notifications
    (user_id, audience, source, type, title, message, link)
  values (new.student_id, 'student', 'system', 'squad_placed',
          'You are in ' || squad_name,
          'Your squad competes every week. Everything you finish — lots, ' ||
          'explanations, topics — adds to its score.',
          '/student/dashboard');
  return null;
end $fn$;

drop trigger if exists squad_members_notify on public.squad_members;
create trigger squad_members_notify
  after insert on public.squad_members
  for each row execute function public.notify_squad_placement();


-- ── step 5: "the system assigns students into squads" ───────────────────
-- It did not — a person pressed a button. It now runs nightly for every
-- college with a season open, and does nothing on the nights when no branch
-- has eleven unplaced students waiting.
create or replace function public.form_all_colleges()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare c record; made integer := 0; placed integer := 0; r jsonb;
begin
  for c in
    select distinct s.college_id from public.seasons s
     where s.is_current and s.status = 'active' and s.college_id is not null
  loop
    begin
      r := public.form_squads(c.college_id);
      made   := made   + coalesce((r->>'squads_created')::int, 0);
      placed := placed + coalesce((r->>'students_placed')::int, 0);
    exception when others then
      -- One college's problem must not stop every other college's morning.
      raise notice 'squad formation failed for %: %', c.college_id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'squads_created', made,
                            'students_placed', placed, 'ran_at', now());
end $fn$;

revoke all on function public.form_all_colleges() from public, anon, authenticated;

select cron.schedule('prooflab-auto-squads', '5 0 * * *',
  $cron$ select public.form_all_colleges(); $cron$);


-- ── step 16: "each Sunday at the configured weekly cutoff" ──────────────
-- It ran Monday 02:00 UTC, which is 07:30 Monday morning in India: the week
-- closed while students were waking up. Sunday 18:00 UTC is 23:30 Sunday night
-- there, so the results are settled before Monday starts.
select cron.unschedule('prooflab-weekly-squad-scoring');
select cron.schedule('prooflab-weekly-squad-scoring', '0 18 * * 0',
  $cron$ select public.run_all_seasons(); $cron$);


-- ── the phone, where the officer actually needs it ──────────────────────
-- Whole function restored rather than edited: an earlier attempt at this
-- rewrote it from a partial reading and silently dropped recent_work,
-- interventions, voice_recordings, tasks and activity_30d — every one of which
-- the college's student drawer reads.
create or replace function public.tpo_student_profile(_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  cid uuid := public.my_college_id();
  me  uuid := (select auth.uid());
  p record;
  may_see boolean;
begin
  select * into p from public.student_profiles where id = _student_id;
  if p is null then return jsonb_build_object('error','no such student'); end if;

  may_see :=
       (cid is not null and p.college_id is not null and p.college_id = cid)
    or coalesce(public.is_admin(), false)
    or (me is not null and p.id = me);

  if not coalesce(may_see, false) then
    return jsonb_build_object('error','that student is not at your college');
  end if;

  return jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'roll_number', p.roll_number,
    'branch', p.branch,
    'batch', p.batch,
    'email', (select c.email from public.student_contact c where c.student_id = p.id),
    'phone', (select c.phone from public.student_contact c where c.student_id = p.id),
    'trust_score', p.trust_score,
    'total_xp', p.total_xp,
    'joined_at', p.created_at,
    'last_active', p.last_active,
    'days_quiet', case when p.last_active is null then 999
                       else (current_date - p.last_active::date) end,

    'onboarding', jsonb_build_object(
      'status', p.onboarding_status,
      'profile_completed', p.profile_completed,
      'calibration_completed', p.calibration_completed,
      'first_task_completed', p.first_task_completed,
      'invited_at', p.invited_at,
      'onboarded_at', p.onboarded_at),

    'squad', (select jsonb_build_object(
                'id', q.id, 'name', q.name, 'role', m.membership_type,
                'contribution', m.contribution, 'joined_at', m.joined_at)
                from public.squad_members m
                join public.squads q on q.id = m.squad_id
               where m.student_id = p.id and m.left_at is null limit 1),

    'activity_30d', (select coalesce(jsonb_agg(t order by t.n desc), '[]'::jsonb) from (
        select event_type, count(*) as n
          from public.student_activity_events
         where student_id = p.id and occurred_at >= now() - interval '30 days'
         group by event_type) t),

    'skills', (select coalesce(jsonb_agg(jsonb_build_object(
                 'skill', s.skill, 'status', s.status,
                 'score', s.assessed_score, 'lots', s.proven_lots)
                 order by s.status, s.skill), '[]'::jsonb)
                 from public.student_skills s where s.student_id = p.id),

    'tasks', jsonb_build_object(
      'assigned',  (select count(*) from public.task_assignments where student_id = p.id),
      'completed', (select count(*) from public.task_assignments
                     where student_id = p.id and status = 'completed')),

    'voice_recordings', (select count(*) from public.voice_explanations where student_id = p.id),

    'recent_work', (select coalesce(jsonb_agg(w order by w.submitted_at desc), '[]'::jsonb) from (
        select pu.id, pu.file_name, pu.status, pu.ai_score,
               pu.admin_review_status, pu.submitted_at,
               (select t.title from public.tasks t where t.id = pu.task_id) as task_title
          from public.proof_uploads pu
         where pu.student_id = p.id
         order by pu.submitted_at desc nulls last limit 5) w),

    'interventions', (select coalesce(jsonb_agg(jsonb_build_object(
                        'type', i.type, 'reason', i.reason, 'created_at', i.created_at)
                        order by i.created_at desc), '[]'::jsonb)
                        from public.interventions i where i.student_id = p.id)
  );
end $fn$;

revoke all on function public.tpo_student_profile(uuid) from public, anon;
grant execute on function public.tpo_student_profile(uuid) to authenticated;
