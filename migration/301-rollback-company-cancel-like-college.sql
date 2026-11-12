-- Rollback of 301: 300's soft cancel.
begin;
create or replace function public.company_cancel_lot(_task_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp' set "TimeZone" to 'Asia/Kolkata' as $f$
declare rid uuid := public.my_recruiter_id(); t record; firm text; uid uuid; prev text;
begin
  if rid is null or not public.my_company_ok() then
    raise exception 'Your company account is awaiting approval.';
  end if;
  select id, student_id, title, lot_date into t from public.tasks
   where id = _task_id and sponsored_by = rid for update;
  if t.id is null or t.student_id is null then
    raise exception 'No such task of yours.';
  end if;
  if exists (select 1 from public.task_submissions where task_id = _task_id) then
    raise exception 'The student has already handed in work for this task, so it cannot be cancelled.';
  end if;
  select user_id into uid from public.student_profiles where id = t.student_id;
  select company into firm from public.recruiters where id = rid;
  prev := current_setting('app.system_write', true);
  perform set_config('app.system_write', 'on', true);
  update public.tasks
     set status = 'cancelled', student_id = null, lot_date = null,
         ai_metadata = coalesce(ai_metadata, '{}'::jsonb) || jsonb_build_object('cancelled', jsonb_build_object(
           'student_id', t.student_id, 'lot_date', t.lot_date, 'at', now(), 'by', rid))
   where id = _task_id;
  perform set_config('app.system_write', coalesce(prev, ''), true);
  if uid is not null then
    insert into public.notifications (user_id, audience, source, type, title, message, link, dedupe_key)
    values (uid, 'student', 'system', 'sponsored_task', coalesce(firm, 'A company') || ' cancelled a task',
            '"' || left(t.title, 80) || '" was cancelled. You do not need to do it.',
            '/student/tasks/assigned', 'company_cancel:' || _task_id)
    on conflict (user_id, type, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return jsonb_build_object('ok', true, 'task_id', _task_id);
end $f$;
revoke all on function public.company_cancel_lot(uuid) from public, anon;
grant execute on function public.company_cancel_lot(uuid) to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
