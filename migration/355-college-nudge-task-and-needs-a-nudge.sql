-- 355 (Grok retest, TEST, 12 Nov 2026):
--   F7: "A nudge from your college" opened today's Daily Lot even when the college had set the student a task.
--       Now it opens the student's newest college-assigned task not yet passed (one still open first), else today's
--       Lot, else the tasks page.
--   F8: Home said "Needs attention 52/52": the count took every tpo_attention() flag (onboarding, a missed Lot even
--       when the student tried one today). "Needs a nudge" is now migration 297's rule only: no Lot tried in the
--       last 7 India days (reason code 'inactive'). Changed: tpo_home.needs_attention, tpo_insights.attention_total,
--       tpo_students.attention (badge + 'attention' filter). tpo_attention() itself is unchanged (Home breakdown,
--       the college bell and the 'missed_lots' filter still use all its flags).
--   F17: Students "All squads" listed every squad of every past season (369 rows, names repeated). Now each squad
--       name of the current season(s) once.
-- Rollback: migration/355-rollback-college-nudge-task-and-needs-a-nudge.sql
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

  -- 355 (F7): the task this college set the student comes first.
  select t.id into lot from public.tasks t
    left join public.task_assignments a on a.task_id = t.id
   where t.created_by_college_id = cid
     and coalesce(a.student_id, t.student_id) = _student_id
     and not exists (select 1 from public.task_submissions s
                      where s.task_id = t.id and s.student_id = _student_id and s.status = 'passed')
   order by (t.due_date is not null and t.due_date < now()), t.created_at desc limit 1;

  if lot is null then
    select t.id into lot from public.tasks t
     where t.student_id = _student_id and t.lot_date = current_date
       and not exists (select 1 from public.task_submissions s where s.task_id = t.id and s.status = 'passed')
     order by t.created_at desc limit 1;
  end if;

  insert into public.notifications (user_id, type, title, message, link)
  values (_student_id, 'reminder', 'A nudge from your college',
          coalesce(_message, 'Your college has noticed you have been quiet. Pick up where you left off.'),
          case when lot is null then '/student/tasks/assigned' else '/student/tasks/assigned?open=' || lot end);

  perform public.write_audit('REMINDER_SENT', 'interventions', iv, null,
                             jsonb_build_object('student_id', _student_id, 'reason', _reason), cid);
  return jsonb_build_object('ok', true, 'student', student.full_name, 'intervention_id', iv);
end $function$;

-- F8: the three counts, edited in place (rest of each live body unchanged, as 325 does).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.tpo_home'::regproc);
  if position('''needs_attention'', jsonb_array_length(attention_rows)' in d) = 0 then
    raise exception '355: tpo_home needs_attention line not found'; end if;
  execute replace(d, '''needs_attention'', jsonb_array_length(attention_rows)',
    '''needs_attention'', (select count(*) from jsonb_array_elements(attention_rows) r where r -> ''reason_codes'' ? ''inactive'')');

  d := pg_get_functiondef('public.tpo_insights'::regproc);
  if position('''attention_total'', (select count(*) from public.tpo_attention())' in d) = 0 then
    raise exception '355: tpo_insights attention_total line not found'; end if;
  execute replace(d, '''attention_total'', (select count(*) from public.tpo_attention())',
    '''attention_total'', (select count(*) from public.tpo_attention() a where ''inactive'' = any(a.reason_codes))');

  d := pg_get_functiondef('public.tpo_students(text,text,text,text,text,text,integer,integer)'::regprocedure);
  if position('coalesce(att.severity, ''ok'') as attn' in d) = 0 then
    raise exception '355: tpo_students attn line not found'; end if;
  execute replace(d, 'coalesce(att.severity, ''ok'') as attn',
    'case when ''inactive'' = any(att.reason_codes) then att.severity else ''ok'' end as attn');
end $$;

-- F17
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
    'squads',   coalesce((select jsonb_agg(distinct q.name order by q.name)
                            from public.squads q join public.seasons s on s.id = q.season_id
                           where q.college_id = public.my_college_id() and s.is_current), '[]'::jsonb),
    'skills',   coalesce((select jsonb_agg(distinct s.skill order by s.skill)
                            from public.student_skills s
                            join public.student_profiles p on p.id = s.student_id
                           where p.college_id = public.my_college_id()
                             and s.status = 'needs_improvement'), '[]'::jsonb)
  );
$function$;

do $$
begin
  if position('created_by_college_id = cid' in pg_get_functiondef('public.tpo_send_reminder(uuid,text,text)'::regprocedure)) = 0 then
    raise exception '355 self-check: nudge does not look for the college task'; end if;
  if position('? ''inactive''' in pg_get_functiondef('public.tpo_home'::regproc)) = 0 then
    raise exception '355 self-check: tpo_home count not changed'; end if;
  if position('''inactive'' = any(a.reason_codes)' in pg_get_functiondef('public.tpo_insights'::regproc)) = 0 then
    raise exception '355 self-check: tpo_insights count not changed'; end if;
  if position('''inactive'' = any(att.reason_codes)' in pg_get_functiondef('public.tpo_students(text,text,text,text,text,text,integer,integer)'::regprocedure)) = 0 then
    raise exception '355 self-check: tpo_students attention not changed'; end if;
  if position('distinct q.name' in pg_get_functiondef('public.tpo_student_filters'::regproc)) = 0 then
    raise exception '355 self-check: squad list not distinct'; end if;
  if not exists (select 1 from pg_proc where proname in ('tpo_home', 'tpo_students') and proconfig @> array['TimeZone=Asia/Kolkata']) then
    raise exception '355 self-check: lost India time'; end if;
end $$;
notify pgrst, 'reload schema';
commit;
