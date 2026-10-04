-- STAGING ONLY. The 2,000-student test population for the release load test
-- (staging_journey_2k.py). Uses the existing synthetic students "Load Student 1..2000"
-- (10 LOADTEST colleges, 6 branches, squads already formed by form_squads) and gives each
-- of them one task per ramp stage, so every stage submits fresh work (lot_date stays empty:
-- the product allows one Lot per student per day, and today's real Lot is left alone):
--   stage 1..9 = 100, 250, 500, 750, 1000, 1250, 1500, 1750, 2000 students.
-- Coding tasks use real, generated and quality-gated Python configs (3 different problems);
-- every third student gets a written task instead (2 different rubrics).
-- Every row is marked: title starts 'LOAD2K s<stage> ', ids start 10ad2000-.
\set ON_ERROR_STOP on
do $$
begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception 'This is not the staging database. Refusing.';
  end if;
end $$;
select set_config('app.system_write', 'on', false);

create temp table load2k_code as
select id, row_number() over (order by created_at desc) as k
  from public.task_sandbox_config
 where language = 'python' and coalesce(reference_solution, '') <> ''
   and jsonb_array_length(test_cases) >= 4
   and exists (select 1 from jsonb_array_elements(test_cases) e where e ? 'kind')
 order by created_at desc limit 3;

create temp table load2k_written as
select id, row_number() over (order by created_at desc) as k
  from public.task_rubric_config
 where not coalesce(is_generic_fallback, false) and coalesce(reference_answer, '') <> ''
   and scratch_language is null
 order by created_at desc limit 2;

do $$
begin
  if (select count(*) from load2k_code) < 3 or (select count(*) from load2k_written) < 2 then
    raise exception 'not enough validated configs: code=% written=%',
      (select count(*) from load2k_code), (select count(*) from load2k_written);
  end if;
end $$;

insert into public.tasks (id, student_id, title, description, category, status, source, lot_date, lot_number,
                          lot_category, difficulty, sandbox_config_id, rubric_config_id, started_at, due_date)
select ('10ad2000-' || lpad(s.stage::text, 4, '0') || '-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       ('10ad0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'LOAD2K s' || s.stage || ' ' || case when n % 3 = 0 then 'written' else 'code' end || ' #' || n,
       'Load-test task for the 2,000-student release check (stage ' || s.stage || ').',
       'technical', 'pending', 'lot', null, 900 + s.stage, 'technical', 'Easy',
       case when n % 3 <> 0 then (select id from load2k_code where k = 1 + n % 3) end,
       case when n % 3 = 0 then (select id from load2k_written where k = 1 + (n / 3) % 2) end,
       now(), (current_date + 1)::timestamptz
  from (values (1, 100), (2, 250), (3, 500), (4, 750), (5, 1000), (6, 1250), (7, 1500), (8, 1750), (9, 2000)) s(stage, users)
  cross join lateral generate_series(1, s.users) n
on conflict (id) do nothing;

select 'LOAD2K tasks=' || (select count(*) from public.tasks where title like 'LOAD2K s%')
    || ' code_configs=' || (select string_agg(id::text, ',') from load2k_code)
    || ' written_configs=' || (select string_agg(id::text, ',') from load2k_written)
    || ' colleges=' || (select count(distinct college_id) from public.student_profiles where id in (select student_id from public.tasks where title like 'LOAD2K s9 %'))
    || ' squads=' || (select count(distinct sm.squad_id) from public.squad_members sm where sm.student_id in (select student_id from public.tasks where title like 'LOAD2K s9 %'));
