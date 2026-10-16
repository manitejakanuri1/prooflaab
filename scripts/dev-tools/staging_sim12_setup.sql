-- STAGING ONLY. A 12-week squad season squeezed into one day ("time machine").
--   1 college "SIM12 College" (approved) + its TPO login account
--   66 students in 2 sections (CSE-A, CSE-B) -> 3 squads of 11 per section, by the product's own form_squads()
--   season started 77 days ago, so TODAY is the first day of week 12
--   weeks 1-11 of activity written with past dates, one behaviour per squad (by name inside each section):
--     1st strong, 2nd average, 3rd weak; except CSE-B's 1st, which is strong until week 6 and then stops
-- 3 students (sim12.s1/s2/s3) and the TPO get real logins afterwards (staging_iso_fixtures.py --create).
-- Weeks are then played by staging_sim12_run.sql. Remove everything with staging_sim12_remove.sql.
-- Every row is marked: ids start 51120000 / 5112c011, emails sim12.*@staging.prooflab.invalid.
\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception 'This is not the staging database. Refusing.';
  end if;
  if exists (select 1 from public.colleges where name = 'SIM12 College') then
    raise exception 'SIM12 College already exists. Run staging_sim12_remove.sql first.';
  end if;
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', false);

begin;

-- 1. TPO account and college.
insert into auth.users (id, email, email_confirmed_at)
values ('5112c011-0000-4000-8000-000000000001', 'sim12.tpo@staging.prooflab.invalid', now());
insert into public.user_roles (user_id, role, has_completed_wizard)
values ('5112c011-0000-4000-8000-000000000001', 'college_admin', true);
insert into public.colleges (id, user_id, name, email, status, verification_status)
values ('5112c011-0000-4000-9000-000000000001', '5112c011-0000-4000-8000-000000000001',
        'SIM12 College', 'sim12.tpo@staging.prooflab.invalid', 'active', 'approved');

-- 2. 66 students, 33 per section.
insert into auth.users (id, email, email_confirmed_at)
select ('51120000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'sim12.s' || n || '@staging.prooflab.invalid', now()
  from generate_series(1, 66) n;
insert into public.user_roles (user_id, role, has_completed_wizard)
select ('51120000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'student', true
  from generate_series(1, 66) n;
insert into public.student_profiles (
  id, user_id, full_name, college_id, branch, batch, cohort, roll_number, year_of_study,
  status, source, onboarding_status, total_xp, target_role, preferred_skills)
select u, u, 'Sim Student ' || n, '5112c011-0000-4000-9000-000000000001',
       'CSE', '2027', case when n % 2 = 1 then 'CSE-A' else 'CSE-B' end, 'SIM' || lpad(n::text, 4, '0'), '3',
       'active', 'College', 'completed', (n * 37) % 900, 'Backend Developer', array['python', 'sql']
  from generate_series(1, 66) n
  cross join lateral (select ('51120000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as u) x;
-- Intake done, so the three login students land on the dashboard, not the onboarding screens.
insert into public.student_intake (user_id, has_seen_welcome, welcome_seen_at, task_source, intake_completed_at)
select ('51120000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, true, now(), 'general', now()
  from generate_series(1, 66) n
on conflict (user_id) do nothing;

-- 3. Login links for the TPO and students 1-3 (staging_iso_fixtures.py creates the logins from these).
insert into public.account_identities (provider_uid, user_id, email)
select u::text, u, e from (values
  ('5112c011-0000-4000-8000-000000000001'::uuid, 'sim12.tpo@staging.prooflab.invalid'),
  ('51120000-0000-4000-8000-000000000001'::uuid, 'sim12.s1@staging.prooflab.invalid'),
  ('51120000-0000-4000-8000-000000000002'::uuid, 'sim12.s2@staging.prooflab.invalid'),
  ('51120000-0000-4000-8000-000000000003'::uuid, 'sim12.s3@staging.prooflab.invalid')) v(u, e);

-- 3b. Staging has lost the platform-default scoring rules (college_id null), so every staging
--     college scores 0. Give SIM12 its own copy of the six defaults (stage 16 values); removed
--     with the college. The platform rows are left alone.
insert into public.squad_scoring_rules (metric, label, points, description, college_id)
select v.metric, v.label, v.points, v.description, '5112c011-0000-4000-9000-000000000001'
  from (values
    ('lot_submitted',      'Lot submitted',        10, 'The daily task, done.'),
    ('proof_verified',     'Proof verified',       25, 'Work that survived checking.'),
    ('topic_cleared',      'Topic cleared',        12, 'A step of the roadmap finished.'),
    ('voice_recorded',     'Explanation recorded', 8,  'Saying out loud what you built.'),
    ('match_participated', 'Match played',         5,  'Turning up for the squad.'),
    ('active_day',         'Active day',           3,  'Counted once per day.')) v(metric, label, points, description);

-- 4. The season: whatever the college trigger opened, moved so that week 1 began 77 days ago.
do $$
declare sid uuid := public.ensure_season('5112c011-0000-4000-9000-000000000001');
begin
  update public.seasons
     set starts_on = current_date - 77, ends_on = current_date + 7, planned_weeks = 12, status = 'active', is_current = true
   where id = sid;
  raise notice 'season % week now %', sid, public.season_week(sid);
  raise notice 'form_squads %', public.form_squads('5112c011-0000-4000-9000-000000000001', sid);
end $$;

-- 5. Weeks 1-11 of activity. Behaviour comes from the squad's position by name (1..4).
--    Each student-day: a Lot submitted with probability p; on a submitted day a voice
--    recording one time in two and a verified proof one time in five.
with sq as (
  select q.id, q.cohort, row_number() over (partition by q.cohort order by q.name) as k
    from public.squads q join public.seasons s on s.id = q.season_id
   where s.college_id = '5112c011-0000-4000-9000-000000000001' and s.is_current
), plan as (
  select m.student_id, sq.k, w, d,
         (current_date - 77 + (w - 1) * 7 + d)::timestamptz + interval '10 hours' as at,
         case when sq.k = 1 and sq.cohort = 'CSE-B' then case when w <= 6 then 0.85 else 0 end
              when sq.k = 1 then 0.85 when sq.k = 2 then 0.55 else 0.20 end as p,
         abs(hashtext(m.student_id::text || '-' || w || '-' || d)) % 100 as roll
    from public.squad_members m join sq on sq.id = m.squad_id
   cross join generate_series(1, 11) w cross join generate_series(0, 6) d
   where m.left_at is null
), done as (select * from plan where roll < p * 100)
insert into public.student_activity_events (student_id, college_id, event_type, source_type, occurred_at, metadata)
select student_id, '5112c011-0000-4000-9000-000000000001', e.t, 'sim12', at + e.off, '{"sim12":true}'::jsonb
  from done
 cross join lateral (values ('lot_submitted', interval '0'), ('voice_recorded', interval '5 minutes'),
                            ('proof_verified', interval '10 minutes')) e(t, off)
 where e.t = 'lot_submitted'
    or (e.t = 'voice_recorded' and roll % 2 = 0)
    or (e.t = 'proof_verified' and roll % 5 = 0);

commit;

select 'SIM12 squads: ' || string_agg(q.name || ' (' || q.cohort || ', ' || (select count(*) from public.squad_members m where m.squad_id = q.id and m.left_at is null) || ' students)', '; ' order by q.name)
  from public.squads q join public.seasons s on s.id = q.season_id
 where s.college_id = '5112c011-0000-4000-9000-000000000001' and s.is_current;
select 'SIM12 events weeks 1-11: ' || count(*) from public.student_activity_events where source_type = 'sim12';
select 'SIM12 login students: ' || string_agg(u.email || ' -> ' || q.name, ', ' order by u.email)
  from auth.users u join public.squad_members m on m.student_id = u.id and m.left_at is null join public.squads q on q.id = m.squad_id
 where u.email in ('sim12.s1@staging.prooflab.invalid', 'sim12.s2@staging.prooflab.invalid', 'sim12.s3@staging.prooflab.invalid');
