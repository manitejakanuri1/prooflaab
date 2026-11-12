-- 296 (owner E2E 12 Nov 2026, C6): "A nudge from your college" linked to /student/dashboard, the page the student is
-- usually already on, so a tap only closed the panel. A new nudge now opens today's Lot when the student has one
-- not yet passed, else the tasks page. Old nudges with the dashboard link open the tasks page.
-- Rollback: migration/296-rollback-college-nudge-opens-tasks.sql
begin;

create or replace function public.tpo_send_reminder(_student_id uuid, _reason text, _message text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' set timezone to 'Asia/Kolkata' as $function$
declare cid uuid := public.my_college_id(); student record; iv uuid; lot uuid;
begin
  if cid is null then raise exception 'only a college can send a reminder'; end if;
  select * into student from public.student_profiles where id = _student_id;
  if student is null or student.college_id is distinct from cid then
    raise exception 'that student is not at your college'; end if;

  insert into public.interventions (college_id, student_id, created_by, type, reason, message)
  values (cid, _student_id, (select auth.uid()), 'reminder', _reason,
          coalesce(_message, 'Your college has noticed you have been quiet. Pick up where you left off.'))
  returning id into iv;

  select t.id into lot from public.tasks t
   where t.student_id = _student_id and t.lot_date = current_date
     and not exists (select 1 from public.task_submissions s where s.task_id = t.id and s.status = 'passed')
   order by t.created_at desc limit 1;

  insert into public.notifications (user_id, type, title, message, link)
  values (_student_id, 'reminder', 'A nudge from your college',
          coalesce(_message, 'Your college has noticed you have been quiet. Pick up where you left off.'),
          case when lot is null then '/student/tasks/assigned' else '/student/tasks/assigned?open=' || lot end);

  perform public.write_audit('REMINDER_SENT', 'interventions', iv, null,
                             jsonb_build_object('student_id', _student_id, 'reason', _reason), cid);
  return jsonb_build_object('ok', true, 'student', student.full_name, 'intervention_id', iv);
end $function$;

update public.notifications set link = '/student/tasks/assigned'
 where type = 'reminder' and title = 'A nudge from your college' and (link is null or link = '/student/dashboard');

do $$
begin
  if position('/student/tasks/assigned' in pg_get_functiondef('public.tpo_send_reminder(uuid,text,text)'::regprocedure)) = 0 then
    raise exception '296 self-check: tpo_send_reminder still links elsewhere';
  end if;
  if exists (select 1 from public.notifications where type = 'reminder' and title = 'A nudge from your college'
              and (link is null or link = '/student/dashboard')) then
    raise exception '296 self-check: an old nudge still has no tasks link';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
