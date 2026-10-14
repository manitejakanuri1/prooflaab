-- 104 rollback: restores review_task_submission exactly as migration 86 wrote it and removes the three new functions.
-- After this, reviews can again run twice under a race, a moot review fails on the one-pass index, and students are
-- not told outcomes. submit-written-task (S31) tolerates a missing similar_written_answer: it then flags nothing.
-- Notifications already sent are kept.
begin;

create or replace function public.review_task_submission(_submission_id uuid, _approve boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  sub   record;
  t     record;
  n     integer;
  xp    integer := 0;
  prev  text;
  topic text;
  may_review boolean;
begin
  select * into sub from public.task_submissions where id = _submission_id;

  -- Who may review is decided before anything about the submission is said. A missing submission
  -- has no owning college, so only an admin can learn that it does not exist.
  select coalesce(public.is_admin(), false)
      or exists (
           select 1 from public.student_profiles sp
             join public.colleges c on c.id = sp.college_id
            where sp.id = sub.student_id
              and c.user_id = (select auth.uid())
              and c.verification_status = 'approved')
    into may_review;
  if not coalesce(may_review, false) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if sub.id is null then return jsonb_build_object('ok', false, 'reason', 'no such submission'); end if;
  if sub.status <> 'needs_review' then
    return jsonb_build_object('ok', false, 'reason', 'not awaiting review');
  end if;

  if not _approve then
    update public.task_submissions set status = 'failed' where id = _submission_id;
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;

  select id, student_id, xp_reward, source, level_id into t from public.tasks where id = sub.task_id;
  if t.level_id is not null then
    select skill into topic from public.levels where id = t.level_id;
  end if;

  update public.task_submissions set status = 'passed' where id = _submission_id;

  prev := current_setting('app.system_write', true);
  perform set_config('app.system_write', 'on', true);

  if t.student_id = sub.student_id then
    update public.tasks set status = 'completed', completed_at = now() where id = t.id;
  else
    update public.task_assignments
       set status = 'completed', completed_at = now(), submitted_at = now()
     where task_id = t.id and student_id = sub.student_id;
  end if;

  if coalesce(t.xp_reward, 0) > 0 then
    insert into public.xp_logs (student_id, xp_points, source)
    values (sub.student_id, t.xp_reward, 'task:' || t.id)
    on conflict (student_id, source) where source like 'task:%' do nothing;
    get diagnostics n = row_count;
    if n > 0 then
      update public.student_profiles set total_xp = coalesce(total_xp, 0) + t.xp_reward
       where id = sub.student_id;
      xp := t.xp_reward;
      update public.task_submissions set xp_awarded = xp where id = _submission_id;
    end if;
  end if;

  perform set_config('app.system_write', coalesce(prev, ''), true);

  perform public.log_activity(sub.student_id, 'task_completed', 'task_submissions', sub.id,
                              jsonb_build_object('task_id', t.id, 'kind', 'rubric', 'reviewed', true));
  perform public.record_activity(sub.student_id, 'task_completed');

  if t.source = 'daily_lot' then
    perform public.record_activity(sub.student_id, 'lot_submitted');
    if topic is not null then
      perform public.record_topic_attempt(sub.student_id, topic, 'correct', t.level_id, null);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'status', 'passed', 'xp_awarded', xp);
end $function$;

revoke all on function public.review_task_submission(uuid, boolean) from public, anon;
grant execute on function public.review_task_submission(uuid, boolean) to authenticated, service_role;

drop function if exists public.notify_pending_reviews();
drop function if exists public.notify_review_outcome(uuid, text);
drop function if exists public.similar_written_answer(uuid, uuid, text);

do $$
begin
  if position('notify_review_outcome' in pg_get_functiondef('public.review_task_submission(uuid, boolean)'::regprocedure)) > 0 then
    raise exception '104 rollback: review_task_submission still calls notify_review_outcome';
  end if;
  if to_regprocedure('public.similar_written_answer(uuid, uuid, text)') is not null
     or to_regprocedure('public.notify_pending_reviews()') is not null then
    raise exception '104 rollback: a 104 function is still present';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
