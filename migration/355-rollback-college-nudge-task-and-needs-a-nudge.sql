-- Rollback of 355: nudge back to 296 (today's Lot first), counts back to every tpo_attention flag, squad list back to all seasons.
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

do $$
declare d text;
begin
  d := pg_get_functiondef('public.tpo_home'::regproc);
  execute replace(d, '''needs_attention'', (select count(*) from jsonb_array_elements(attention_rows) r where r -> ''reason_codes'' ? ''inactive'')',
    '''needs_attention'', jsonb_array_length(attention_rows)');
  d := pg_get_functiondef('public.tpo_insights'::regproc);
  execute replace(d, '''attention_total'', (select count(*) from public.tpo_attention() a where ''inactive'' = any(a.reason_codes))',
    '''attention_total'', (select count(*) from public.tpo_attention())');
  d := pg_get_functiondef('public.tpo_students(text,text,text,text,text,text,integer,integer)'::regprocedure);
  execute replace(d, 'case when ''inactive'' = any(att.reason_codes) then att.severity else ''ok'' end as attn',
    'coalesce(att.severity, ''ok'') as attn');
end $$;

create or replace function public.tpo_student_filters()
 returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select jsonb_build_object(
    'branches', coalesce((select jsonb_agg(distinct branch order by branch)
                            from public.student_profiles
                           where college_id = public.my_college_id()
                             and branch is not null and branch <> ''), '[]'::jsonb),
    'batches',  coalesce((select jsonb_agg(distinct batch order by batch)
                            from public.student_profiles
                           where college_id = public.my_college_id()
                             and batch is not null and batch <> ''), '[]'::jsonb),
    'squads',   coalesce((select jsonb_agg(name order by name)
                            from public.squads
                           where college_id = public.my_college_id()), '[]'::jsonb),
    'skills',   coalesce((select jsonb_agg(distinct s.skill order by s.skill)
                            from public.student_skills s
                            join public.student_profiles p on p.id = s.student_id
                           where p.college_id = public.my_college_id()
                             and s.status = 'needs_improvement'), '[]'::jsonb)
  );
$function$;
notify pgrst, 'reload schema';
commit;
