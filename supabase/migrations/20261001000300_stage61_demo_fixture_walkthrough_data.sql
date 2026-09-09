-- Stage 61 — demo fixture data for the existing three seeded demo accounts
-- (Demo Engineering College / demo.college@prooflab.test, and its three
-- students: yashwanthdharantejillip@gmail.com, demo.student@prooflab.test,
-- and PURNA MANI TEJA KANURI). This is fixture data, not a real school.
--
-- Why this migration exists: this data was originally written directly
-- against the live database (not through this migrations folder) to build
-- a walkthrough of the student -> proof -> trust -> squad -> season loop
-- for a presentation. Real schema changes are always migrations; this one
-- captures the demo DATA itself, so a fresh environment (or a DB rebuilt
-- from migrations) reproduces the same walkthrough instead of losing it.
--
-- Every block is guarded so this is safe to run again on a database that
-- already has this data (idempotent), and safe to run on a database that
-- does not have the three demo accounts yet (it silently does nothing for
-- a block whose parent row is missing, rather than erroring).

-- ---------------------------------------------------------------------
-- Fix: the three demo students had college_id = null, which silently
-- hides their squad from their own dashboard (RLS on squads/squad_members
-- checks viewer_college_id(), which reads student_profiles.college_id).
-- This was a real data gap, not demo dressing.
-- ---------------------------------------------------------------------
update public.student_profiles
set college_id = '165e89b0-4ff3-425d-8e4b-44f137c01f34'
where id in (
  'e724043f-cba0-4df6-a4ad-03eb17bf223f', -- Yashwanth Pilli
  '3998c495-64f9-4b13-ad0e-9ddfee97b34d', -- PURNA MANI TEJA KANURI
  '9f77c6d5-bd7c-489e-9410-3db888729328'  -- Demo Student
)
and college_id is null;

-- ---------------------------------------------------------------------
-- Squad: Kernel Panic, cohort CSE-A, under the demo college's Season 1
-- ---------------------------------------------------------------------
do $$
declare
  v_college_id uuid := '165e89b0-4ff3-425d-8e4b-44f137c01f34';
  v_season_id  uuid := 'b07b9ae3-9121-4780-b31b-cb8ba8fdf9ff';
  v_yash  uuid := 'e724043f-cba0-4df6-a4ad-03eb17bf223f';
  v_purna uuid := '3998c495-64f9-4b13-ad0e-9ddfee97b34d';
  v_demo  uuid := '9f77c6d5-bd7c-489e-9410-3db888729328';
  v_squad_id uuid;
  v_level_html   uuid := '22be4ba3-ab0b-46e7-8862-f11e96e951d7';
  v_level_js     uuid := '3f6901fa-deda-4bf6-917a-8e3f997e0abe';
  v_level_ts     uuid := 'f8bfc921-ecec-4f26-96b2-d5f6ac82000a';
  v_level_react  uuid := '3121ef7e-3ba1-4239-95b8-0e192eb9c96e';
  v_task_html uuid;
  v_task_js   uuid;
  v_task_ts   uuid;
  v_task_lot  uuid;
begin
  -- Only run this fixture if the demo college and demo students actually
  -- exist in this environment. A fresh, non-demo environment no-ops here.
  if not exists (select 1 from public.colleges where id = v_college_id) then
    return;
  end if;
  if not exists (select 1 from public.student_profiles where id = v_yash) then
    return;
  end if;

  if not exists (select 1 from public.squads where college_id = v_college_id and name = 'Kernel Panic') then
    insert into public.squads (name, college_id, season_id, max_members, points, wins, losses, draws, rank, previous_rank, cohort)
    values ('Kernel Panic', v_college_id, v_season_id, 11, 233, 2, 1, 0, 1, 2, 'CSE-A')
    returning id into v_squad_id;
  else
    select id into v_squad_id from public.squads where college_id = v_college_id and name = 'Kernel Panic';
  end if;

  insert into public.squad_members (squad_id, student_id, membership_type, contribution, joined_at)
  select v_squad_id, v_yash, 'captain', 158, now() - interval '9 days'
  where not exists (select 1 from public.squad_members where squad_id = v_squad_id and student_id = v_yash);

  insert into public.squad_members (squad_id, student_id, membership_type, contribution, joined_at)
  select v_squad_id, v_purna, 'regular', 75, now() - interval '9 days'
  where not exists (select 1 from public.squad_members where squad_id = v_squad_id and student_id = v_purna);

  insert into public.squad_members (squad_id, student_id, membership_type, contribution, joined_at)
  select v_squad_id, v_demo, 'regular', 0, now() - interval '9 days'
  where not exists (select 1 from public.squad_members where squad_id = v_squad_id and student_id = v_demo);

  -- Yashwanth's Tracks placement on web-development, unlocked through
  -- level 4 (HTML/CSS, JavaScript and TypeScript checkpoints cleared)
  insert into public.student_tracks (student_id, track_slug, is_primary, placed_at_level, unlocked_through)
  select v_yash, 'web-development', true, 1, 4
  where not exists (select 1 from public.student_tracks where student_id = v_yash and track_slug = 'web-development');

  insert into public.student_levels (student_id, level_id, status, attempts, best_score, cleared_at)
  select v_yash, v_level_html, 'cleared', 1, 4, now() - interval '8 days'
  where not exists (select 1 from public.student_levels where student_id = v_yash and level_id = v_level_html);

  insert into public.student_levels (student_id, level_id, status, attempts, best_score, cleared_at)
  select v_yash, v_level_js, 'cleared', 1, 5, now() - interval '5 days'
  where not exists (select 1 from public.student_levels where student_id = v_yash and level_id = v_level_js);

  insert into public.student_levels (student_id, level_id, status, attempts, best_score, cleared_at)
  select v_yash, v_level_ts, 'cleared', 2, 4, now() - interval '2 days'
  where not exists (select 1 from public.student_levels where student_id = v_yash and level_id = v_level_ts);

  insert into public.student_levels (student_id, level_id, status, attempts, best_score)
  select v_yash, v_level_react, 'placed', 0, 0
  where not exists (select 1 from public.student_levels where student_id = v_yash and level_id = v_level_react);

  -- Three Tracks checkpoint proof tasks (40 XP each) and one Lot (25 XP).
  -- Matched on business identity (student + level + source, and for the Lot
  -- student + source) rather than on a fixed id: on a database where this
  -- data was originally created by hand the ids are server-generated, so an
  -- id-keyed guard would miss them and insert duplicates. The Lot in
  -- particular is protected by a unique (student_id, lot_date) constraint,
  -- so a blind re-insert is an error, not just a duplicate.
  select id into v_task_html from public.tasks
   where student_id = v_yash and level_id = v_level_html and source = 'level_checkpoint' limit 1;
  if v_task_html is null then
    insert into public.tasks (student_id, title, description, category, status, visibility, source, level_id, xp, xp_reward, difficulty, completed_at, created_at)
    values (v_yash, 'HTML/CSS -- Check yourself: proof of work', 'Ship something real using the HTML/CSS fundamentals from this checkpoint.', 'technical', 'completed', 'private', 'level_checkpoint', v_level_html, 40, 40, 'Easy', now() - interval '8 days', now() - interval '9 days')
    returning id into v_task_html;
  end if;

  select id into v_task_js from public.tasks
   where student_id = v_yash and level_id = v_level_js and source = 'level_checkpoint' limit 1;
  if v_task_js is null then
    insert into public.tasks (student_id, title, description, category, status, visibility, source, level_id, xp, xp_reward, difficulty, completed_at, created_at)
    values (v_yash, 'JavaScript -- Check yourself: proof of work', 'Ship something real using core JavaScript.', 'technical', 'completed', 'private', 'level_checkpoint', v_level_js, 40, 40, 'Medium', now() - interval '5 days', now() - interval '6 days')
    returning id into v_task_js;
  end if;

  select id into v_task_ts from public.tasks
   where student_id = v_yash and level_id = v_level_ts and source = 'level_checkpoint' limit 1;
  if v_task_ts is null then
    insert into public.tasks (student_id, title, description, category, status, visibility, source, level_id, xp, xp_reward, difficulty, completed_at, created_at)
    values (v_yash, 'TypeScript -- Check yourself: proof of work', 'Ship something real using TypeScript.', 'technical', 'completed', 'private', 'level_checkpoint', v_level_ts, 40, 40, 'Medium', now() - interval '2 days', now() - interval '3 days')
    returning id into v_task_ts;
  end if;

  select id into v_task_lot from public.tasks
   where student_id = v_yash and source = 'lot' limit 1;
  if v_task_lot is null then
    insert into public.tasks (student_id, title, description, category, status, visibility, source, xp, xp_reward, difficulty, is_ai_generated, lot_number, lot_date, lot_category, completed_at, created_at)
    values (v_yash, 'Rate-limit a public API endpoint', 'Design and implement a rate limiter for a real API route.', 'technical', 'completed', 'private', 'lot', 25, 25, 'Medium', true, 47, current_date, 'technical', now() - interval '2 hours', now() - interval '1 day')
    returning id into v_task_lot;
  end if;

  -- Proof uploads, inserted pending then updated to Verified so the real
  -- on_proof_change / activity_from_proof triggers fire exactly as they
  -- would for a genuine submission, rather than faking a terminal state.
  if not exists (select 1 from public.proof_uploads where task_id = v_task_html and student_id = v_yash) then
    insert into public.proof_uploads (task_id, student_id, status, is_public, submission_notes, file_type, file_url, declaration_acknowledged, submitted_at)
    values (v_task_html, v_yash, 'pending', true, 'Landing page rebuild, semantic HTML + responsive CSS.', 'link', 'https://github.com/YashwanthDT/html-css-checkpoint', true, now() - interval '8 days');
  end if;
  if not exists (select 1 from public.proof_uploads where task_id = v_task_js and student_id = v_yash) then
    insert into public.proof_uploads (task_id, student_id, status, is_public, submission_notes, file_type, file_url, declaration_acknowledged, submitted_at)
    values (v_task_js, v_yash, 'pending', true, 'Small vanilla JS state manager, no framework.', 'link', 'https://github.com/YashwanthDT/js-state-manager', true, now() - interval '5 days');
  end if;
  if not exists (select 1 from public.proof_uploads where task_id = v_task_ts and student_id = v_yash) then
    insert into public.proof_uploads (task_id, student_id, status, is_public, submission_notes, file_type, file_url, declaration_acknowledged, submitted_at)
    values (v_task_ts, v_yash, 'pending', true, 'Typed API client wrapper, generics + discriminated unions.', 'link', 'https://github.com/YashwanthDT/ts-api-client', true, now() - interval '2 days');
  end if;
  if not exists (select 1 from public.proof_uploads where task_id = v_task_lot and student_id = v_yash) then
    insert into public.proof_uploads (task_id, student_id, status, is_public, submission_notes, file_type, file_url, declaration_acknowledged, submitted_at)
    values (v_task_lot, v_yash, 'pending', true, 'Token-bucket limiter on VoxScript AI''s FastAPI backend.', 'link', 'https://github.com/YashwanthDT/voxscript-ai', true, now() - interval '2 hours');
  end if;

  perform set_config('app.system_write', 'on', true);

  update public.proof_uploads set status='Verified', admin_review_status='Verified', ai_status='completed', ai_score=88,
    ai_summary='Clean semantic structure, real responsive breakpoints, no template boilerplate.', moss_status='completed', moss_score=4, reviewed_at=now()-interval '8 days'
   where task_id=v_task_html and student_id=v_yash and status <> 'Verified';
  update public.proof_uploads set status='Verified', admin_review_status='Verified', ai_status='completed', ai_score=82,
    ai_summary='Working closures, real commit history, no signs of copy-paste.', moss_status='completed', moss_score=6, reviewed_at=now()-interval '5 days'
   where task_id=v_task_js and student_id=v_yash and status <> 'Verified';
  update public.proof_uploads set status='Verified', admin_review_status='Verified', ai_status='completed', ai_score=91,
    ai_summary='Strong type coverage, real usage patterns, high originality.', moss_status='completed', moss_score=3, reviewed_at=now()-interval '2 days'
   where task_id=v_task_ts and student_id=v_yash and status <> 'Verified';
  update public.proof_uploads set status='Verified', admin_review_status='Verified', ai_status='completed', ai_score=87,
    ai_summary='Real repo, active commit history, matches the described approach.', moss_status='completed', moss_score=5, reviewed_at=now()-interval '2 hours'
   where task_id=v_task_lot and student_id=v_yash and status <> 'Verified';

  perform set_config('app.system_write', 'off', true);

  insert into public.trust_scores (student_id, score, commit_authenticity_score, ai_authorship_score, conceptual_understanding_score, cognitive_integrity_score)
  select v_yash, 82, 88, 90, 74, 80
  where not exists (select 1 from public.trust_scores where student_id = v_yash);

  update public.student_profiles set trust_score = 82, total_xp = greatest(coalesce(total_xp,0), 145)
  where id = v_yash and coalesce(trust_score, 0) = 0;

  insert into public.topic_ratings (student_id, topic, rating, confidence, attempts, seeded_by)
  select v_yash, t.topic, t.rating, t.confidence, t.attempts, t.seeded_by
  from (values
    ('HTML/CSS',   1520, 0.8, 3, 'attempt'),
    ('JavaScript', 1610, 0.7, 2, 'attempt'),
    ('TypeScript', 1580, 0.6, 2, 'attempt'),
    ('React',      1180, 0.3, 1, 'placement')
  ) as t(topic, rating, confidence, attempts, seeded_by)
  where not exists (
    select 1 from public.topic_ratings tr where tr.student_id = v_yash and tr.topic = t.topic
  );

  insert into public.xp_logs (student_id, xp_points, source)
  select v_yash, x.xp, x.source
  from (values (40, 'level_checkpoint'), (40, 'level_checkpoint'), (40, 'level_checkpoint'), (25, 'lot')) as x(xp, source)
  where not exists (select 1 from public.xp_logs where student_id = v_yash);

  insert into public.squad_weekly_scores (season_id, squad_id, week, points, active_members, total_members, rank, breakdown)
  select v_season_id, v_squad_id, 1, 233, 2, 3, 1, jsonb_build_object('proof_verified', 100, 'topic_cleared', 36, 'lot_submitted', 10, 'active_day', 9)
  where not exists (select 1 from public.squad_weekly_scores where squad_id = v_squad_id and week = 1);

  insert into public.student_weekly_scores (season_id, student_id, squad_id, week, points, breakdown)
  select v_season_id, v_yash, v_squad_id, 1, 158, jsonb_build_object('proof_verified',100,'topic_cleared',36,'lot_submitted',10,'active_day',9,'voice_recorded',3)
  where not exists (select 1 from public.student_weekly_scores where student_id = v_yash and week = 1);

  insert into public.student_weekly_scores (season_id, student_id, squad_id, week, points, breakdown)
  select v_season_id, v_purna, v_squad_id, 1, 75, jsonb_build_object('proof_verified',50,'topic_cleared',12,'lot_submitted',10,'active_day',3)
  where not exists (select 1 from public.student_weekly_scores where student_id = v_purna and week = 1);

  insert into public.student_weekly_scores (season_id, student_id, squad_id, week, points, breakdown)
  select v_season_id, v_demo, v_squad_id, 1, 0, '{}'::jsonb
  where not exists (select 1 from public.student_weekly_scores where student_id = v_demo and week = 1);
end $$;
