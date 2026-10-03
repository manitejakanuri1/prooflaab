-- 56: every task has an evaluator; company Lots get a real one (§14, §15).
--
-- 1. tasks_have_evaluator: a task can no longer exist without a grading config
--    (sandbox tests or a rubric). Until now an insert without one silently got
--    the generic written checklist from a trigger - and on a database where that
--    checklist was not seeded, a task with NO evaluator at all (found on staging,
--    3 Oct 2026). The trigger still fills the generic checklist for written work
--    nobody configured (roadmap, assigned tasks); coding work never relies on it.
-- 2. company_create_lot(...): the ONLY way a company creates work for students.
--    Called by the company-lot function after the shared engine has built and
--    validated the evaluator (sandbox for coding, task-specific rubric for written).
--    It keeps every rule sponsor_lot had (verified company, shortlisted and
--    discoverable students, one Lot per day) and refuses work without an evaluator.
-- 3. sponsor_lot is no longer callable from a browser: it created work with no
--    evaluator of its own, so a coding brief was graded as an essay.
--    (Company "Post a task" never worked against PostgREST: tasks RLS refuses a
--    company insert. Students also have no screen to apply to posted tasks.)
--
-- Rollback: migration/56-rollback-company-lots.sql
begin;

-- the generic written checklist must exist wherever the default trigger relies on it
insert into public.task_rubric_config
  (prompt_text, criteria, min_words, max_words, pass_threshold, reference_answer, is_generic_fallback, origin)
select
  'The student was asked to complete a real-world work task as described on their task card. Grade their written submission for genuine effort, relevance to the task, and clarity of explanation.',
  '[{"id":"effort","name":"Effort & Relevance","description":"The answer directly addresses the task and shows real engagement with it, not a generic or evasive response.","max_points":40},{"id":"soundness","name":"Correctness / Soundness","description":"The explained approach is technically correct and would actually work.","max_points":30},{"id":"clarity","name":"Clarity of Explanation","description":"A reader unfamiliar with the task could follow the reasoning.","max_points":30}]'::jsonb,
  100, 1000, 60,
  'I read the task card carefully, worked out exactly what was being asked, broke the work into small pieces, checked each piece against the situation described, and explained honestly what I did and why it addresses the task.',
  true, 'auto_fallback'
where not exists (select 1 from public.task_rubric_config where is_generic_fallback);

-- any open task still without an evaluator gets the written checklist (the trigger's own rule)
update public.tasks
   set rubric_config_id = (select id from public.task_rubric_config where is_generic_fallback limit 1)
 where sandbox_config_id is null and rubric_config_id is null;

alter table public.tasks drop constraint if exists tasks_have_evaluator;
alter table public.tasks add constraint tasks_have_evaluator
  check (sandbox_config_id is not null or rubric_config_id is not null);

create or replace function public.company_create_lot(
  _company uuid, _student_ids uuid[], _title text, _scenario text, _code_sample text,
  _criteria text, _days integer, _sandbox_config_id uuid, _rubric_config_id uuid,
  _difficulty text default 'Medium', _estimate_minutes integer default 45, _lot_category text default 'technical'
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  firm text; sid uuid; tid uuid; n integer; made uuid[] := '{}'; skipped jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.recruiters r where r.id = _company and r.verified) then
    raise exception 'Your company account is awaiting approval.';
  end if;
  if _sandbox_config_id is null and _rubric_config_id is null then
    raise exception 'A Lot needs an evaluator.';
  end if;
  if _sandbox_config_id is not null and not exists (select 1 from public.task_sandbox_config where id = _sandbox_config_id) then
    raise exception 'Unknown coding evaluator.';
  end if;
  if _rubric_config_id is not null and not exists (
      select 1 from public.task_rubric_config where id = _rubric_config_id and not is_generic_fallback) then
    raise exception 'A company Lot needs its own rubric, not the generic checklist.';
  end if;
  if nullif(trim(coalesce(_title, '')), '') is null or nullif(trim(coalesce(_scenario, '')), '') is null then
    raise exception 'A Lot needs a title and a task.';
  end if;
  if coalesce(array_length(_student_ids, 1), 0) = 0 or array_length(_student_ids, 1) > 50 then
    raise exception 'Choose 1 to 50 shortlisted students.';
  end if;
  select r.company into firm from public.recruiters r where r.id = _company;

  foreach sid in array _student_ids loop
    if not public.student_is_discoverable(sid)
       or not exists (select 1 from public.recruiter_shortlists s where s.recruiter_id = _company and s.student_id = sid) then
      skipped := skipped || jsonb_build_object('student_id', sid, 'reason', 'not shortlisted or not discoverable');
      continue;
    end if;
    select count(*) + 1 into n from public.tasks where student_id = sid and lot_date is not null;
    insert into public.tasks
      (student_id, title, description, code_sample, sponsored_by, sponsor_criteria,
       lot_number, lot_date, lot_category, difficulty, estimate_minutes,
       status, visibility, due_date, created_by_type, source,
       sandbox_config_id, rubric_config_id, is_ai_generated)
    values
      (sid, trim(_title), trim(_scenario), nullif(_code_sample, ''), _company, nullif(trim(coalesce(_criteria, '')), ''),
       n,
       case when exists (select 1 from public.tasks t where t.student_id = sid and t.lot_date = current_date)
            then current_date + 1 else current_date end,
       coalesce(_lot_category, 'technical'), coalesce(_difficulty, 'Medium'), coalesce(_estimate_minutes, 45),
       'pending', 'private', now() + make_interval(days => greatest(1, coalesce(_days, 7))), 'recruiter', 'sponsored',
       _sandbox_config_id, _rubric_config_id, true)
    on conflict (student_id, lot_date) where lot_date is not null do nothing
    returning id into tid;
    if tid is null then
      skipped := skipped || jsonb_build_object('student_id', sid, 'reason', 'already has a Lot for that day');
      continue;
    end if;
    made := made || tid;
    update public.recruiter_shortlists set stage = 'sponsored' where recruiter_id = _company and student_id = sid;
    insert into public.notifications (user_id, audience, source, type, title, message, link)
    values (sid, 'student', 'system', 'sponsored_task', firm || ' set you a task',
            'A company has set you a piece of work. It is on your Daily Card, and they will review what you submit.',
            '/student/dashboard');
  end loop;
  return jsonb_build_object('ok', true, 'task_ids', to_jsonb(made), 'skipped', skipped, 'company', firm);
end $fn$;

revoke all on function public.company_create_lot(uuid, uuid[], text, text, text, text, integer, uuid, uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.company_create_lot(uuid, uuid[], text, text, text, text, integer, uuid, uuid, text, integer, text)
  to service_role;
revoke execute on function public.sponsor_lot(uuid, text, text, text, integer) from authenticated;

do $$
declare raised boolean := false;
begin
  begin
    insert into public.tasks (title, description, status) values ('no evaluator', 'x', 'pending');
    -- the default trigger fills the generic rubric, so this insert is allowed; delete it again
    delete from public.tasks where title = 'no evaluator' and description = 'x';
  exception when check_violation then raised := true;
  end;
  if exists (select 1 from public.tasks where sandbox_config_id is null and rubric_config_id is null) then
    raise exception 'a task without an evaluator still exists';
  end if;
  if has_function_privilege('authenticated', 'public.sponsor_lot(uuid, text, text, text, integer)', 'EXECUTE') then
    raise exception 'browsers can still create unevaluated sponsored work';
  end if;
  if has_function_privilege('authenticated', 'public.company_create_lot(uuid, uuid[], text, text, text, text, integer, uuid, uuid, text, integer, text)', 'EXECUTE') then
    raise exception 'browsers can call company_create_lot directly';
  end if;
  raise notice '56: every task has an evaluator; company Lots go through the engine';
end $$;

commit;
notify pgrst, 'reload schema';
