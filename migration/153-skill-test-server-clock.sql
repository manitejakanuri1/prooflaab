-- 153 (MF-043): the skill test's countdown lives on the server.
-- Before, each question's timer and the answers so far lived only in browser storage, so reloading (or clearing
-- site data and reloading) gave a fresh 30/90 seconds. Now the first time a question is shown the server stores
-- its deadline, and every later look at that question gets the same deadline back. Each answer is saved here as
-- the student moves on; one saved more than 10 seconds after its deadline is marked late and scores as empty
-- (resume-assessment-submit). Coding problems get a 5-minute deadline the same way (resume-code-execute).
-- Only the student who owns the test can start a clock or save an answer; the table itself is closed to browsers.
-- Rollback: migration/153-rollback-skill-test-server-clock.sql
begin;

create table public.resume_question_clock (
  assessment_id uuid not null references public.resume_assessments(id) on delete cascade,
  question_id text not null,
  deadline timestamptz not null,
  answer jsonb,
  answered_at timestamptz,
  late boolean not null default false,
  primary key (assessment_id, question_id)
);
alter table public.resume_question_clock enable row level security;
revoke all on table public.resume_question_clock from public, anon, authenticated;
grant select, insert, update, delete on table public.resume_question_clock to service_role;

-- Starts the clock for one question (first call only) and says how long is left. With _question_id null it only
-- reports, so a reload can find where the student was. Seconds must match secondsFor() in TimedResumeAssessment.
create or replace function public.resume_test_clock(_assessment_id uuid, _question_id text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a record;
  q jsonb;
  secs int;
begin
  select ra.id, ra.status, ra.questions, ra.coding_questions into a
  from resume_assessments ra join student_profiles sp on sp.id = ra.student_id
  where ra.id = _assessment_id and sp.user_id = auth.uid();
  if a.id is null then
    raise exception 'test not found' using errcode = 'P0002';
  end if;

  if _question_id is not null then
    select x into q from jsonb_array_elements(coalesce(a.questions, '[]')) x where x ->> 'id' = _question_id;
    if q is not null then
      if a.status <> 'pending' then
        return jsonb_build_object('submitted', true);
      end if;
      secs := case when q ->> 'type' = 'mcq' then 30 else 90 end;
    elsif exists (select 1 from jsonb_array_elements(coalesce(a.coding_questions, '[]')) x
                   where x ->> 'id' = _question_id) then
      secs := 300;
    else
      raise exception 'question not in this test' using errcode = '22023';
    end if;
    insert into resume_question_clock (assessment_id, question_id, deadline)
    values (_assessment_id, _question_id, now() + make_interval(secs => secs))
    on conflict do nothing;
  end if;

  return jsonb_build_object(
    'submitted', a.status <> 'pending',
    'seconds_left', (select greatest(0, ceil(extract(epoch from c.deadline - now())))::int
                     from resume_question_clock c
                     where c.assessment_id = _assessment_id and c.question_id = _question_id),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('question_id', c.question_id, 'answer', c.answer,
                                                             'late', c.late))
                         from resume_question_clock c
                         where c.assessment_id = _assessment_id and c.answered_at is not null), '[]'));
end $$;

-- Saves one quiz answer, once. Late (over 10 seconds past the deadline) answers are kept but marked late.
create or replace function public.resume_test_answer(_assessment_id uuid, _question_id text, _answer jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if octet_length(coalesce(_answer, '{}')::text) > 20000 then
    raise exception 'answer too long' using errcode = '22023';
  end if;
  if not exists (select 1 from resume_assessments ra join student_profiles sp on sp.id = ra.student_id
                  where ra.id = _assessment_id and sp.user_id = auth.uid() and ra.status = 'pending') then
    raise exception 'test not open' using errcode = 'P0002';
  end if;
  update resume_question_clock
     set answer = _answer, answered_at = now(), late = now() > deadline + interval '10 seconds'
   where assessment_id = _assessment_id and question_id = _question_id and answered_at is null;
  if not found and not exists (select 1 from resume_question_clock
                                where assessment_id = _assessment_id and question_id = _question_id) then
    raise exception 'question not started' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.resume_test_clock(uuid, text) from public, anon;
revoke all on function public.resume_test_answer(uuid, text, jsonb) from public, anon;
grant execute on function public.resume_test_clock(uuid, text) to authenticated, service_role;
grant execute on function public.resume_test_answer(uuid, text, jsonb) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.resume_test_clock(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.resume_test_answer(uuid, text, jsonb)', 'execute') then
    raise exception '153 self-check: a logged-out caller can use the test clock';
  end if;
  if not has_function_privilege('authenticated', 'public.resume_test_clock(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.resume_test_answer(uuid, text, jsonb)', 'execute') then
    raise exception '153 self-check: students cannot use the test clock';
  end if;
  if has_table_privilege('authenticated', 'public.resume_question_clock', 'select')
     or has_table_privilege('anon', 'public.resume_question_clock', 'select')
     or not (select relrowsecurity from pg_class where oid = 'public.resume_question_clock'::regclass) then
    raise exception '153 self-check: the clock table is open to browsers';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
