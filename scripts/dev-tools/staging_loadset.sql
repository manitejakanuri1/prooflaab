-- STAGING ONLY. A synthetic 15,000-student dataset for scale tests (Wave 12).
--   10 colleges x 1,500 students, squads formed by the product's own form_squads(),
--   7 days of Lots per student (105,000 tasks), ~60% of them submitted, and a scored
--   spoken explanation on about a third of the passed ones.
-- Every row is recognisable and removable: colleges are named "LOADTEST College NN",
-- accounts use *@loadtest.invalid, and ids start with 10ad0000 / 10adc011.
-- Remove with scripts/dev-tools/staging_loadset_remove.sql.
-- No real person, no login (nothing is created in the login pool), no AI call.
\set ON_ERROR_STOP on
\timing on

do $$
begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception 'This is not the staging database (staging fixtures missing). Refusing to load test data.';
  end if;
end $$;

-- Rows are written by the server role in the product; say so, so the same triggers behave the same.
select set_config('request.jwt.claims', '{"role":"service_role"}', false);

-- 1. Colleges and their owner accounts.
insert into auth.users (id, email, email_confirmed_at)
select ('10adc011-0000-4000-8000-' || lpad(c::text, 12, '0'))::uuid, 'college' || c || '@loadtest.invalid', now()
  from generate_series(1, 10) c
on conflict (id) do nothing;

insert into public.user_roles (user_id, role, has_completed_wizard)
select ('10adc011-0000-4000-8000-' || lpad(c::text, 12, '0'))::uuid, 'college_admin', true
  from generate_series(1, 10) c
on conflict (user_id) do nothing;

insert into public.colleges (id, user_id, name, email, status, verification_status)
select ('10adc011-0000-4000-9000-' || lpad(c::text, 12, '0'))::uuid,
       ('10adc011-0000-4000-8000-' || lpad(c::text, 12, '0'))::uuid,
       'LOADTEST College ' || lpad(c::text, 2, '0'), 'college' || c || '@loadtest.invalid', 'active', 'approved'
  from generate_series(1, 10) c
on conflict (id) do nothing;

-- 2. 15,000 students.
insert into auth.users (id, email, email_confirmed_at)
select ('10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'load.' || n || '@loadtest.invalid', now()
  from generate_series(1, 15000) n
on conflict (id) do nothing;

insert into public.user_roles (user_id, role, has_completed_wizard)
select ('10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'student', true
  from generate_series(1, 15000) n
on conflict (user_id) do nothing;

insert into public.student_profiles (
  id, user_id, full_name, college_id, branch, batch, cohort, roll_number, year_of_study,
  status, source, onboarding_status, total_xp, last_active, target_role, preferred_skills)
select u, u, 'Load Student ' || n,
       ('10adc011-0000-4000-9000-' || lpad(((n - 1) % 10 + 1)::text, 12, '0'))::uuid,
       b.branch, '2027', b.branch || '-' || chr(65 + ((n / 60) % 4)),
       'LT' || lpad(n::text, 6, '0'), '3',
       'active', 'College', case when n % 20 = 0 then 'invited' else 'completed' end,
       (abs(hashtext('xp' || n)) % 2000),
       now() - make_interval(hours => abs(hashtext('la' || n)) % 400),
       (array['Backend Developer','Data Analyst','Frontend Developer','DevOps Engineer'])[1 + n % 4],
       string_to_array((array['python,sql','javascript,react','java,dsa','linux,docker'])[1 + n % 4], ',')
  from generate_series(1, 15000) n
  cross join lateral (select ('10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as u) x
  cross join lateral (select (array['CSE','ECE','EEE','MECH','CIVIL','IT'])[1 + n % 6] as branch) b
on conflict (id) do nothing;

-- 3. Squads, by the product's own function (elevens inside each section).
do $$
declare c record; t0 timestamptz; r jsonb;
begin
  for c in select id, name from public.colleges where name like 'LOADTEST College %' order by name loop
    t0 := clock_timestamp();
    r := public.form_squads(c.id);
    raise notice 'form_squads % -> % squads, % placed in % ms', c.name, r->>'squads_created', r->>'students_placed',
      round(extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
end $$;

-- 4. Seven days of Lots per student (one a day), written checker shared by all.
insert into public.tasks (id, student_id, title, description, category, status, source, lot_date, lot_number,
                          lot_category, difficulty, rubric_config_id, started_at, due_date)
select ('10ad7a5c-' || lpad(d::text, 4, '0') || '-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       ('10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'Load Lot day ' || d || ': explain a rollback plan',
       'You are on call. A deploy went wrong this morning. Your task: write the steps you would take to roll back safely, and say how you would check the rollback worked. What to write: 5 to 8 short steps.',
       'technical',
       case when abs(hashtext('s' || n || '-' || d)) % 10 < 6 and d > 0 then 'completed' else 'pending' end,
       'lot', current_date - d, 100 - d, 'technical', 'Easy',
       (select id from public.task_rubric_config order by created_at limit 1),
       case when abs(hashtext('s' || n || '-' || d)) % 10 < 7 then now() - make_interval(days => d) end,
       (current_date - d + 1)::timestamptz
  from generate_series(1, 15000) n cross join generate_series(0, 6) d
on conflict (id) do nothing;

-- 5. Submissions for ~60% of past Lots; one in five has an earlier failed attempt.
insert into public.task_submissions (id, task_id, student_id, rubric_config_id, code, sandbox_score, status, created_at, xp_awarded)
select ('10ad50b0-' || lpad(d::text, 4, '0') || '-4000-' || a || '000-' || lpad(n::text, 12, '0'))::uuid,
       ('10ad7a5c-' || lpad(d::text, 4, '0') || '-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       ('10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       (select id from public.task_rubric_config order by created_at limit 1),
       '1. Stop the rollout. 2. Check which version is live. 3. Re-deploy the last good version. 4. Watch error rates for ten minutes. 5. Tell the team what happened. (synthetic answer ' || n || '/' || d || ')',
       case when a = 9 then 70 + abs(hashtext('sc' || n || d)) % 30 else 30 end,
       case when a = 9 then 'passed' else 'failed' end,
       now() - make_interval(days => d, mins => case when a = 9 then 0 else 20 end),
       case when a = 9 then 20 else 0 end
  from generate_series(1, 15000) n cross join generate_series(1, 6) d cross join (values (8), (9)) att(a)
 where abs(hashtext('s' || n || '-' || d)) % 10 < 6
   and (a = 9 or abs(hashtext('f' || n || '-' || d)) % 5 = 0)
on conflict (id) do nothing;

-- 6. A scored spoken explanation on about a third of the passed submissions.
--    In batches of 500 students: each recording takes a short per-submission lock when it is
--    bound (migration 61), and one statement holding ~18,000 of them exhausts the lock table.
--    The product inserts one recording per transaction, so it never meets this.
select format($voice$
insert into public.voice_explanations (id, student_id, task_id, submission_id, storage_path, duration_seconds, transcript,
                                       transcript_source, word_count, communication_score, communication_notes,
                                       status, transcription_status, evaluation, created_at)
select ('10ad701c-' || lpad(d::text, 4, '0') || '-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       ('10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       ('10ad7a5c-' || lpad(d::text, 4, '0') || '-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       ('10ad50b0-' || lpad(d::text, 4, '0') || '-4000-9000-' || lpad(n::text, 12, '0'))::uuid,
       '10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0') || '/loadset-' || d || '.webm', 45,
       'First I stopped the rollout, then I checked which version was live. I redeployed the last good build and watched the error rate. I was not sure about the database change so I asked before touching it.',
       'server', 38, 55 + abs(hashtext('v' || n || d)) %% 40, 'Synthetic note.', 'scored', 'completed',
       '{"evaluator_version":"voice-eval-2","content_match":80,"flags":[],"linked_to_submission":true}'::jsonb,
       now() - make_interval(days => d) + interval '5 minutes'
  from generate_series(%s, %s) n cross join generate_series(1, 6) d
 where abs(hashtext('s' || n || '-' || d)) %% 10 < 6 and abs(hashtext('vx' || n || '-' || d)) %% 3 = 0
on conflict (id) do nothing
$voice$, lo, lo + 499)
  from generate_series(1, 15000, 500) lo
\gexec

-- 7. Two students in five are discoverable by companies (public profile + public portfolio)
--    and have three skills each, so company talent search has 6,000 candidates to rank.
update public.student_profiles set profile_visibility = 'public'
 where full_name like 'Load Student %' and (substring(full_name from 14)::int % 5) < 2
   and profile_visibility is distinct from 'public';

insert into public.student_portfolios (student_id, slug, is_public, bio)
select ('10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'load-student-' || n, true, 'Synthetic load-test profile.'
  from generate_series(1, 15000) n
 where n % 5 < 2
on conflict do nothing;

insert into public.student_skills (student_id, skill, status, assessed_score)
select ('10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, sk.skill,
       (array['proven','assessed','claimed'])[1 + abs(hashtext(sk.skill || n)) % 3],
       40 + abs(hashtext('sk' || sk.skill || n)) % 60
  from generate_series(1, 15000) n
 cross join lateral unnest(string_to_array((array['python,sql,git','javascript,react,html-css','java,dsa,sql','linux,docker,bash'])[1 + n % 4], ',')) as sk(skill)
 where n % 5 < 2
on conflict do nothing;

analyze;

select 'LOADSET students=' || (select count(*) from public.student_profiles where full_name like 'Load Student %')
    || ' squads=' || (select count(*) from public.squads s join public.colleges c on c.id = s.college_id where c.name like 'LOADTEST College %')
    || ' tasks=' || (select count(*) from public.tasks where title like 'Load Lot day %')
    || ' submissions=' || (select count(*) from public.task_submissions where code like '%(synthetic answer %')
    || ' voice=' || (select count(*) from public.voice_explanations where storage_path like '%/loadset-%')
    || ' db=' || pg_size_pretty(pg_database_size(current_database()));
