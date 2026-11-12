-- 301 (owner company-actions E2E CO11, 12 Nov 2026, TEST): a company's Cancel now works like the college's
--   (migration 295): a task nobody handed in is removed, the full row is kept in the audit log first
--   (COMPANY_TASK_CANCELLED), and the student is told. Replaces 300's soft cancel (no task was cancelled with it).
-- Rollback: migration/301-rollback-company-cancel-like-college.sql (back to 300's version)
begin;
create or replace function public.company_cancel_lot(_task_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp' set "TimeZone" to 'Asia/Kolkata' as $f$
declare rid uuid := public.my_recruiter_id(); t public.tasks; firm text; uid uuid;
begin
  if rid is null or not public.my_company_ok() then
    raise exception 'Your company account is awaiting approval.';
  end if;
  select * into t from public.tasks where id = _task_id and sponsored_by = rid for update;
  if t.id is null or t.student_id is null then
    raise exception 'No such task of yours.';
  end if;
  if exists (select 1 from public.task_submissions where task_id = _task_id)
     or exists (select 1 from public.voice_explanations where task_id = _task_id)
     or exists (select 1 from public.student_levels where task_id = _task_id) then
    raise exception 'The student has already handed in work for this task, so it cannot be cancelled.';
  end if;
  select user_id into uid from public.student_profiles where id = t.student_id;
  select company into firm from public.recruiters where id = rid;
  -- The whole row is kept in the audit log before it goes.
  perform public.write_audit('COMPANY_TASK_CANCELLED', 'tasks', _task_id, to_jsonb(t), null, null);
  delete from public.tasks where id = _task_id;
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
do $$
begin
  if position('COMPANY_TASK_CANCELLED' in pg_get_functiondef('public.company_cancel_lot(uuid)'::regprocedure)) = 0 then
    raise exception '301 self-check';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
