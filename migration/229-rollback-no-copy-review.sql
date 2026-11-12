-- Rollback for 229: record_task_submission sends flagged tries to 'needs_review' again; drops copied_answer_notes.
-- The 5 TEST tries 229 moved (a20da213, afd4cee9, ceba1008, 8786a13c, 0120b1e4) go back to 'needs_review'.
begin;

CREATE OR REPLACE FUNCTION public.record_task_submission(_student_id uuid, _task_id uuid, _sandbox_config_id uuid, _language text, _code text, _passed_count integer, _total_count integer, _score integer, _details jsonb, _runner text, _duration_ms integer, _rubric_config_id uuid DEFAULT NULL::uuid, _rubric_scores jsonb DEFAULT NULL::jsonb, _flags text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  select id, student_id, xp_reward, source, level_id, inserted_by, sandbox_config_id, rubric_config_id
    into t from public.tasks where id = _task_id;
  if pass_threshold is null or t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'task or config missing');
  end if;
  -- 103: a task its own student inserted is never evidence.
  if t.inserted_by is not null and t.inserted_by = t.student_id then
    return jsonb_build_object('ok', false, 'reason', 'self-authored task');
  end if;
  -- 103: only the task's student, or a student it was assigned to, can be graded on it.
  if t.student_id is distinct from _student_id
     and not exists (select 1 from public.task_assignments a
                      where a.task_id = _task_id and a.student_id = _student_id) then
    return jsonb_build_object('ok', false, 'reason', 'not this student''s task');
  end if;
  -- 103: the checker must be the task's own.
  if (_sandbox_config_id is not null and _sandbox_config_id is distinct from t.sandbox_config_id)
     or (_sandbox_config_id is null and _rubric_config_id is distinct from t.rubric_config_id) then
    return jsonb_build_object('ok', false, 'reason', 'checker does not belong to this task');
  end if;
  if coalesce(array_length(_flags, 1), 0) > 0 then
    v_status := 'needs_review';
  elsif _score >= pass_threshold
        and (_sandbox_config_id is null
             or (_total_count > 0 and _passed_count = _total_count
                 and jsonb_typeof(_details) = 'array'
                 and (select coalesce(sum(case when d ->> 'id' = 'hidden-summary' and jsonb_typeof(d -> 'hidden_count') = 'number'
                                               then (d ->> 'hidden_count')::numeric else 1 end), 0)
                        from jsonb_array_elements(_details) d) = _total_count
                 and not exists (select 1 from jsonb_array_elements(_details) d
                                  where (d ->> 'passed') is distinct from 'true'))) then
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
    -- 127: Transition to pending_voice; completed_at and XP wait for complete_voice_scoring
    if t.student_id = _student_id then
      update public.tasks set status = 'pending_voice' where id = _task_id and status <> 'completed';
    else
      update public.task_assignments
         set status = 'pending_voice', submitted_at = now()
       where task_id = _task_id and student_id = _student_id and status <> 'completed';
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
$function$;

update public.task_submissions set status = 'needs_review'
 where id in ('a20da213-48b2-4106-bbc7-ba07f41fc628','afd4cee9-afae-48b6-ac65-03bb4e295e16','ceba1008-608f-4848-8dcc-5199b36449f0',
              '8786a13c-4c9f-454c-bb43-2d785732add5','0120b1e4-18ab-40f6-834f-6145c7de185f');
drop function if exists public.copied_answer_notes(integer);
notify pgrst, 'reload schema';
commit;
