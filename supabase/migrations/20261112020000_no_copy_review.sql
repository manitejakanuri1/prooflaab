-- 229 (Purna 12 Nov 2026, TEST first): no person reviews a "Looks copied" answer any more.
--   1. record_task_submission: flags are still saved, but status is passed/failed by the mark (no 'needs_review').
--   2. The tries still waiting on 'needs_review' get passed/failed by their mark. Their flags are kept.
--   3. copied_answer_notes(): each flagged try with the student it matches most closely (same question), for the
--      admin (all) and for a college (only its own students; the other student is named only if also theirs).
--      Read-only, no action. The college sees it on College Home, the admin in Submissions.
--   needs_review_submissions / review_task_submission / notify_pending_reviews stay (nothing reaches them now).
-- Rollback: migration/229-rollback-no-copy-review.sql
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
  -- 229 (Purna 12 Nov 2026): a flag ("Looks copied") is kept with the try but no longer holds the result for a
  -- person. The try passes or fails on its mark like any other; the copy shows only as a note (copied_answer_notes).
  if _score >= pass_threshold
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

update public.task_submissions s
   set status = case when s.sandbox_score >= coalesce(c.pass_threshold, 101) then 'passed' else 'failed' end
  from public.task_rubric_config c
 where s.status = 'needs_review' and c.id = s.rubric_config_id;

create or replace function public.copied_answer_notes(_limit integer default 50)
returns table(submission_id uuid, created_at timestamptz, task_title text, lot_date date,
              student_name text, student_squad text, other_name text, other_squad text, similarity numeric)
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  with me as (
    select coalesce(public.is_admin(), false) as admin,
           (select c.id from public.colleges c where c.user_id = (select auth.uid()) and c.verification_status = 'approved' limit 1) as college
  ), flagged as (
    select s.id, s.created_at, s.task_id, s.student_id, s.code, s.rubric_config_id, t.title, t.lot_date, t.description, p.college_id
      from public.task_submissions s
      join public.tasks t on t.id = s.task_id
      join public.student_profiles p on p.id = s.student_id, me
     where s.flags @> array['copied_answer']
       and (me.admin or p.college_id = me.college)
     order by s.created_at desc
     limit greatest(1, least(_limit, 200))
  ), squad as (
    select m.student_id, q.name from public.squad_members m join public.squads q on q.id = m.squad_id where m.left_at is null
  )
  select f.id, f.created_at, f.title, f.lot_date, p.full_name, (select name from squad where student_id = f.student_id limit 1),
         case when me.admin or op.college_id = f.college_id then op.full_name else 'a student from another college' end,
         case when me.admin or op.college_id = f.college_id then (select name from squad where student_id = o.student_id limit 1) end,
         round(o.sim::numeric, 2)
    from flagged f
    join public.student_profiles p on p.id = f.student_id
    cross join me
    left join lateral (
      select s2.student_id, similarity(s2.code, f.code) sim
        from public.task_submissions s2 join public.tasks t2 on t2.id = s2.task_id
       where s2.student_id <> f.student_id and s2.rubric_config_id = f.rubric_config_id
         and md5(coalesce(t2.title, '') || '|' || coalesce(t2.description, '')) = md5(coalesce(f.title, '') || '|' || coalesce(f.description, ''))
         and s2.created_at < f.created_at
       order by similarity(s2.code, f.code) desc limit 1) o on true
    left join public.student_profiles op on op.id = o.student_id
   order by f.created_at desc;
$f$;
revoke all on function public.copied_answer_notes(integer) from public, anon;
grant execute on function public.copied_answer_notes(integer) to authenticated, service_role;

do $$
begin
  if position('needs_review' in pg_get_functiondef('public.record_task_submission'::regproc)) > 0 then
    raise exception '229 self-check: record_task_submission still sets needs_review';
  end if;
  if exists (select 1 from public.task_submissions where status = 'needs_review') then
    raise exception '229 self-check: tries still waiting for review';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
