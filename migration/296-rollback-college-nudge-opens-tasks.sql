-- Rollback of 296: nudges link to /student/dashboard again (old rows keep the tasks link; harmless).
begin;
create or replace function public.tpo_send_reminder(_student_id uuid, _reason text, _message text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare cid uuid := public.my_college_id(); student record; iv uuid;
begin
  if cid is null then raise exception 'only a college can send a reminder'; end if;
  select * into student from public.student_profiles where id = _student_id;
  if student is null or student.college_id is distinct from cid then
    raise exception 'that student is not at your college'; end if;

  insert into public.interventions (college_id, student_id, created_by, type, reason, message)
  values (cid, _student_id, (select auth.uid()), 'reminder', _reason,
          coalesce(_message, 'Your college has noticed you have been quiet. Pick up where you left off.'))
  returning id into iv;

  insert into public.notifications (user_id, type, title, message, link)
  values (_student_id, 'reminder', 'A nudge from your college',
          coalesce(_message, 'Your college has noticed you have been quiet. Pick up where you left off.'),
          '/student/dashboard');

  perform public.write_audit('REMINDER_SENT', 'interventions', iv, null,
                             jsonb_build_object('student_id', _student_id, 'reason', _reason), cid);
  return jsonb_build_object('ok', true, 'student', student.full_name, 'intervention_id', iv);
end $function$;
notify pgrst, 'reload schema';
commit;
