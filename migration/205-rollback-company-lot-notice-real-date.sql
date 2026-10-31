-- Rollback of 205: company_create_lot back to its TEST definition before 205 (notice always says 'It is on your Daily Card').
begin;
CREATE OR REPLACE FUNCTION public.company_create_lot(_company uuid, _student_ids uuid[], _title text, _scenario text, _code_sample text, _criteria text, _days integer, _sandbox_config_id uuid, _rubric_config_id uuid, _difficulty text DEFAULT 'Medium'::text, _estimate_minutes integer DEFAULT 45, _lot_category text DEFAULT 'technical'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
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
       -- the next day this student has no Lot yet (one Lot per day), up to 14 days ahead
       (select min(d)::date from generate_series(current_date, current_date + 14, interval '1 day') d
         where not exists (select 1 from public.tasks t where t.student_id = sid and t.lot_date = d::date)),
       coalesce(_lot_category, 'technical'), coalesce(_difficulty, 'Medium'), coalesce(_estimate_minutes, 45),
       'pending', 'private', now() + make_interval(days => greatest(1, coalesce(_days, 7))), 'recruiter', 'sponsored',
       _sandbox_config_id, _rubric_config_id, true)
    on conflict (student_id, lot_date) where lot_date is not null do nothing
    returning id into tid;
    if tid is null then
      skipped := skipped || jsonb_build_object('student_id', sid, 'reason', 'no free day in the next two weeks');
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
end $function$;

do $$ begin
  if pg_get_functiondef('public.company_create_lot'::regproc) ~ 'It will be on your Daily Card on' then
    raise exception '205 rollback: the new notice is still there';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
