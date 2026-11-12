-- 300 (owner company-actions E2E, 12 Nov 2026, TEST):
--   CO1 "Ask for changes": the passed try is marked 'returned' (kept, never deleted), the task opens again, the
--       student is told (bell, link to the task) and sees the note; a new try can pass (task_submissions_one_pass
--       only covers status 'passed'). The company sees the new try (company_submissions shows the latest).
--   CO8 Accept / Reject: the student is told, and the task shows "Accepted by <company>" (tasks.company_review).
--   CO9 tpo_student_companies(): shortlists and accepted work, for the student's own college (or admin).
--   CO11 company_cancel_lot(): a company cancels its own task that has no submission. The row is kept (status
--       'cancelled', who it was for in ai_metadata.cancelled) but leaves the student (student_id and lot_date
--       cleared), so no list, card or count shows it. recruiter_home "open" skips cancelled tasks.
-- Rollback: migration/300-rollback-company-review-loop-cancel.sql
begin;

alter table public.task_submissions drop constraint task_submissions_status_check;
alter table public.task_submissions add constraint task_submissions_status_check
  check (status = any (array['passed', 'failed', 'needs_review', 'returned']));

create or replace function public.company_review_submission(_submission_id uuid, _decision text, _note text default null)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp' set "TimeZone" to 'Asia/Kolkata' as $f$
declare
  me uuid := auth.uid(); s record; firm text; prev text; back text;
  n text := nullif(trim(coalesce(_note, '')), '');
begin
  if not public.my_company_ok() then
    raise exception 'Your company account is awaiting approval.';
  end if;
  if _decision not in ('accepted', 'needs_work', 'rejected') then
    raise exception 'Unknown decision.';
  end if;
  select ts.id, ts.task_id, ts.student_id, ts.status, t.title, t.student_id as owner, p.user_id
    into s
    from public.task_submissions ts
    join public.tasks t on t.id = ts.task_id
    join public.student_profiles p on p.id = ts.student_id
   where ts.id = _submission_id and (t.created_by_startup_id = me or t.sponsored_by = me);
  if s.id is null then
    raise exception 'No such submission on your work.';
  end if;
  insert into public.submission_reviews (submission_id, reviewer_id, decision, note)
  values (_submission_id, me, _decision, n)
  on conflict (submission_id) do update
    set reviewer_id = excluded.reviewer_id, decision = excluded.decision,
        note = excluded.note, reviewed_at = now();

  prev := current_setting('app.system_write', true);
  perform set_config('app.system_write', 'on', true);
  if _decision = 'needs_work' and s.status = 'passed' then
    -- Ask for changes: this try no longer counts as the pass, and the task is open again.
    update public.task_submissions set status = 'returned' where id = s.id;
    if s.owner = s.student_id then
      update public.tasks set status = 'In Progress', completed_at = null
       where id = s.task_id and status in ('pending_voice', 'completed');
    else
      update public.task_assignments set status = 'in_progress', completed_at = null
       where task_id = s.task_id and student_id = s.student_id and status in ('pending_voice', 'completed');
    end if;
  elsif _decision <> 'needs_work' and s.status = 'returned'
        and not exists (select 1 from public.task_submissions x
                         where x.task_id = s.task_id and x.student_id = s.student_id and x.status = 'passed') then
    -- Changed its mind before a new try: the try is the pass again, the task back where it was.
    update public.task_submissions set status = 'passed' where id = s.id;
    back := case when exists (select 1 from public.voice_explanations v
                               where v.submission_id = s.id and v.status = 'scored' and v.withdrawn_at is null)
                 then 'completed' else 'pending_voice' end;
    if s.owner = s.student_id then
      update public.tasks set status = back, completed_at = case when back = 'completed' then coalesce(completed_at, now()) end
       where id = s.task_id and status not in ('pending_voice', 'completed');
    else
      update public.task_assignments set status = back, completed_at = case when back = 'completed' then coalesce(completed_at, now()) end
       where task_id = s.task_id and student_id = s.student_id and status not in ('pending_voice', 'completed');
    end if;
  end if;
  perform set_config('app.system_write', coalesce(prev, ''), true);

  firm := coalesce((select r.company from public.recruiters r where r.id = me),
                   (select st.name from public.startups st where st.user_id = me limit 1), 'The company');
  if s.user_id is not null then
    insert into public.notifications (user_id, audience, source, type, title, message, link, dedupe_key)
    values (s.user_id, 'student', 'system', 'sponsored_task',
            case _decision when 'accepted' then firm || ' accepted your work'
                           when 'needs_work' then firm || ' asked for changes'
                           else firm || ' reviewed your work' end,
            case _decision when 'accepted' then '"' || left(s.title, 80) || '" was accepted.'
                           when 'needs_work' then 'Open "' || left(s.title, 80) || '", read their note and submit a new version.'
                           else '"' || left(s.title, 80) || '" was not accepted this time.' end
              || coalesce(' Their note: ' || left(n, 300), ''),
            '/student/tasks/assigned?open=' || s.task_id,
            'company_review:' || s.id || ':' || _decision)
    on conflict (user_id, type, dedupe_key) where dedupe_key is not null do nothing;
  end if;
  return jsonb_build_object('ok', true, 'submission_id', _submission_id, 'decision', _decision);
end $f$;

-- The company's word on the student's latest handed-in try (a pass, or a pass sent back), for that student.
create or replace function public.company_review(public.tasks)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select jsonb_build_object('decision', r.decision, 'note', r.note, 'at', r.reviewed_at, 'returned', s.status = 'returned')
    from (select x.id, x.status from public.task_submissions x
           where x.task_id = $1.id and x.student_id = $1.student_id and x.status in ('passed', 'returned')
           order by x.created_at desc limit 1) s
    join public.submission_reviews r on r.submission_id = s.id
   where $1.student_id in (select id from public.student_profiles where user_id = (select auth.uid()))
      or coalesce(public.is_admin(), false);
$f$;
revoke all on function public.company_review(public.tasks) from public, anon;
grant execute on function public.company_review(public.tasks) to authenticated, service_role;

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

-- Which companies shortlisted this student, and which of their tasks a company accepted. Own college or admin.
create or replace function public.tpo_student_companies(_student_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
declare cid uuid := public.my_college_id(); sc uuid;
begin
  select college_id into sc from public.student_profiles where id = _student_id;
  if not ((cid is not null and sc is not null and sc = cid) or coalesce(public.is_admin(), false)) then
    return jsonb_build_object('error', 'that student is not at your college');
  end if;
  return jsonb_build_object('companies', coalesce((
    select jsonb_agg(x order by x.last_at desc) from (
      select r.company, sl.created_at as shortlisted_at, sl.stage, sl.student_response,
             (select coalesce(jsonb_agg(jsonb_build_object('title', t.title, 'at', rv.reviewed_at) order by rv.reviewed_at desc), '[]'::jsonb)
                from public.submission_reviews rv
                join public.task_submissions s on s.id = rv.submission_id
                join public.tasks t on t.id = s.task_id
               where t.sponsored_by = r.id and s.student_id = _student_id and rv.decision = 'accepted') as accepted,
             greatest(sl.created_at, sl.updated_at) as last_at
        from public.recruiter_shortlists sl
        join public.recruiters r on r.id = sl.recruiter_id
       where sl.student_id = _student_id) x), '[]'::jsonb));
end $f$;
revoke all on function public.tpo_student_companies(uuid) from public, anon;
grant execute on function public.tpo_student_companies(uuid) to authenticated, service_role;

do $$
declare def text := pg_get_functiondef('public.recruiter_home()'::regprocedure);
  a constant text := 'where t.sponsored_by = rid and not exists';
  b constant text := 'where t.sponsored_by = rid and t.status is distinct from ''cancelled'' and not exists';
begin
  if position(b in def) = 0 then
    if position(a in def) = 0 then raise exception '300: recruiter_home anchor not found'; end if;
    execute replace(def, a, b);
  end if;
end $$;

do $$
begin
  if position('''returned''' in pg_get_constraintdef((select oid from pg_constraint where conname = 'task_submissions_status_check'))) = 0 then
    raise exception '300 self-check: status constraint';
  end if;
  if position('returned' in pg_get_functiondef('public.company_review_submission(uuid,text,text)'::regprocedure)) = 0
     or to_regprocedure('public.company_review(public.tasks)') is null
     or to_regprocedure('public.company_cancel_lot(uuid)') is null
     or to_regprocedure('public.tpo_student_companies(uuid)') is null then
    raise exception '300 self-check: functions';
  end if;
  if position('''cancelled''' in pg_get_functiondef('public.recruiter_home()'::regprocedure)) = 0 then
    raise exception '300 self-check: recruiter_home';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
