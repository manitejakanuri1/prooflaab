-- stage70c: record_task_submission's local variable `status` shadowed the
-- task_submissions.status column inside the `on conflict ... where status =
-- 'passed'` partial-index predicate, so every call failed with "column
-- reference 'status' is ambiguous". Caught by the smoke test before this
-- ever reached a real submit. Renamed to v_status throughout.

begin;

create or replace function public.record_task_submission(
  _student_id uuid,
  _task_id uuid,
  _sandbox_config_id uuid,
  _language text,
  _code text,
  _passed_count integer,
  _total_count integer,
  _score integer,
  _details jsonb,
  _runner text,
  _duration_ms integer,
  _rubric_config_id uuid default null,
  _rubric_scores jsonb default null,
  _flags text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pass_threshold integer;
  t        record;
  sub_id   uuid;
  v_status text;
  n        integer;
  xp       integer := 0;
  prev     text;
  topic    text;
begin
  if _sandbox_config_id is not null then
    select task_sandbox_config.pass_threshold into pass_threshold
      from public.task_sandbox_config where id = _sandbox_config_id;
  elsif _rubric_config_id is not null then
    select task_rubric_config.pass_threshold into pass_threshold
      from public.task_rubric_config where id = _rubric_config_id;
  end if;

  select id, student_id, xp_reward, source, level_id into t from public.tasks where id = _task_id;
  if pass_threshold is null or t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'task or config missing');
  end if;

  if coalesce(array_length(_flags, 1), 0) > 0 then
    v_status := 'needs_review';
  elsif _score >= pass_threshold then
    v_status := 'passed';
  else
    v_status := 'failed';
  end if;

  insert into public.task_submissions
    (task_id, student_id, sandbox_config_id, rubric_config_id, language, code, sandbox_score,
     passed_count, total_count, status, details, runner, duration_ms, rubric_scores, flags)
  values
    (_task_id, _student_id, _sandbox_config_id, _rubric_config_id, _language, _code, _score,
     _passed_count, _total_count, v_status, coalesce(_details, '[]'::jsonb), _runner, _duration_ms,
     _rubric_scores, coalesce(_flags, '{}'))
  on conflict (task_id, student_id) where status = 'passed' do nothing
  returning id into sub_id;

  if sub_id is null then
    return jsonb_build_object('ok', true, 'status', 'passed', 'already_completed', true, 'xp_awarded', 0);
  end if;

  if t.level_id is not null then
    select skill into topic from public.levels where id = t.level_id;
  end if;

  if v_status = 'passed' then
    prev := current_setting('app.system_write', true);
    perform set_config('app.system_write', 'on', true);

    if t.student_id = _student_id then
      update public.tasks set status = 'completed', completed_at = now() where id = _task_id;
    else
      update public.task_assignments
         set status = 'completed', completed_at = now(), submitted_at = now()
       where task_id = _task_id and student_id = _student_id;
    end if;

    if coalesce(t.xp_reward, 0) > 0 then
      insert into public.xp_logs (student_id, xp_points, source)
      values (_student_id, t.xp_reward, 'task:' || _task_id)
      on conflict (student_id, source) where source like 'task:%' do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        update public.student_profiles set total_xp = coalesce(total_xp, 0) + t.xp_reward
         where id = _student_id;
        xp := t.xp_reward;
        update public.task_submissions set xp_awarded = xp where id = sub_id;
      end if;
    end if;

    perform set_config('app.system_write', coalesce(prev, ''), true);

    perform public.log_activity(_student_id, 'task_completed', 'task_submissions', sub_id,
                                jsonb_build_object('task_id', _task_id, 'score', _score,
                                                   'kind', case when _rubric_config_id is not null then 'rubric' else 'sandbox' end));
    perform public.record_activity(_student_id, 'task_completed');

    if t.source = 'daily_lot' then
      perform public.record_activity(_student_id, 'lot_submitted');
      if topic is not null then
        perform public.record_topic_attempt(_student_id, topic, 'correct', t.level_id, null);
      end if;
    end if;

  elsif v_status = 'failed' and t.source = 'daily_lot' and topic is not null
        and not exists (select 1 from public.task_submissions
                         where task_id = _task_id and student_id = _student_id and id <> sub_id) then
    perform public.record_topic_attempt(_student_id, topic, 'incorrect', t.level_id, null);
  end if;

  return jsonb_build_object('ok', true, 'submission_id', sub_id, 'status', v_status,
                            'already_completed', false, 'xp_awarded', xp);
end
$$;

commit;
