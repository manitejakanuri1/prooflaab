-- UNSAFE EMERGENCY SECURITY ROLLBACK of 86.
-- This REOPENS three proven holes: anon/authenticated get TRUNCATE (which ignores row-level
-- security), REFERENCES and TRIGGER on every public table again; a student can again create their
-- own student_credits row with any credits / premium value; and review_task_submission again tells
-- any caller (including anonymous) whether a submission exists and whether it awaits review.
-- Use only if 86 broke a legitimate flow, and re-apply a corrected 86 straight after.
begin;

grant truncate, references, trigger on all tables in schema public to anon, authenticated;

grant select, insert, update, delete, truncate, references, trigger on public.student_credits to anon;
grant insert, update, delete on public.student_credits to authenticated;
create policy student_credits_own_insert on public.student_credits for insert to authenticated
  with check ((student_id = (select auth.uid())) or (select public.is_admin()));
create policy student_credits_own_update on public.student_credits for update to authenticated
  using ((student_id = (select auth.uid())) or (select public.is_admin()))
  with check ((student_id = (select auth.uid())) or (select public.is_admin()));

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
  if sub.id is null then return jsonb_build_object('ok', false, 'reason', 'no such submission'); end if;
  if sub.status <> 'needs_review' then
    return jsonb_build_object('ok', false, 'reason', 'not awaiting review');
  end if;

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
grant execute on function public.review_task_submission(uuid, boolean) to public;

commit;
notify pgrst, 'reload schema';
