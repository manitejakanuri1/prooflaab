-- 205 (MF-013): a company's Lot goes on the student's next free day (57b), but the student's notice always said
-- "It is on your Daily Card" - wrong whenever that day is not today (TEST: ILLIP's Lot sent 27 Oct, dated 28 Oct).
-- The notice now names the real day. Only the message changes; the rest of company_create_lot is as on TEST
-- (57b + 171 India time zone). Existing notifications are not changed.
-- Rollback: migration/205-rollback-company-lot-notice-real-date.sql
begin;

CREATE OR REPLACE FUNCTION public.company_create_lot(_company uuid, _student_ids uuid[], _title text, _scenario text, _code_sample text, _criteria text, _days integer, _sandbox_config_id uuid, _rubric_config_id uuid, _difficulty text DEFAULT 'Medium'::text, _estimate_minutes integer DEFAULT 45, _lot_category text DEFAULT 'technical'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
declare
  firm text; sid uuid; tid uuid; ld date; n integer; made uuid[] := '{}'; skipped jsonb := '[]'::jsonb;
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
    returning id, lot_date into tid, ld;
    if tid is null then
      skipped := skipped || jsonb_build_object('student_id', sid, 'reason', 'no free day in the next two weeks');
      continue;
    end if;
    made := made || tid;
    update public.recruiter_shortlists set stage = 'sponsored' where recruiter_id = _company and student_id = sid;
    insert into public.notifications (user_id, audience, source, type, title, message, link)
    values (sid, 'student', 'system', 'sponsored_task', firm || ' set you a task',
            -- MF-013: the real day, not always "today"
            case when ld = current_date
              then 'A company has set you a piece of work. It is on your Daily Card today, and they will review what you submit.'
              else 'A company has set you a piece of work. It will be on your Daily Card on ' || to_char(ld, 'FMDay FMDD Mon')
                   || ' (one Lot a day). Until then it is in Your Tasks. They will review what you submit.'
            end,
            case when ld = current_date then '/student/dashboard' else '/student/tasks/assigned?open=' || tid end);
  end loop;
  return jsonb_build_object('ok', true, 'task_ids', to_jsonb(made), 'skipped', skipped, 'company', firm);
end $function$;

do $$
declare sig regprocedure;
begin
  select p.oid::regprocedure into sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'company_create_lot';
  if sig is null then raise exception '205 self-check: company_create_lot is missing'; end if;
  if pg_get_functiondef(sig) !~ 'It will be on your Daily Card on' then
    raise exception '205 self-check: the notice does not name the day';
  end if;
  if pg_get_functiondef(sig) !~ 'generate_series\(current_date, current_date \+ 14' then
    raise exception '205 self-check: company_create_lot no longer looks for the next free day';
  end if;
  if has_function_privilege('authenticated', sig, 'execute') or has_function_privilege('anon', sig, 'execute') then
    raise exception '205 self-check: company_create_lot is callable from a browser';
  end if;
  if not has_function_privilege('service_role', sig, 'execute') then
    raise exception '205 self-check: the server cannot call company_create_lot';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
