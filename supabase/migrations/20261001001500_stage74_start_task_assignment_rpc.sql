-- stage74: a real way for a student to start an assigned task
--
-- useAllStudentTasks.tsx's startTask() did two raw client updates:
--   update task_assignments set status = 'in_progress' ...
--   update tasks set started_at = now(), status = 'In Progress' ...
-- Both silently no-op for an admin/college-assigned task, and always have:
--   - protect_task_assignments (BEFORE UPDATE trigger) guards the `status`
--     column via protect_columns(), reverting it for any non-admin,
--     non-system_write caller - so the first update never actually moves
--     status off 'assigned', even though PostgREST still returns 204.
--   - tasks_own_update's RLS requires tasks.student_id = auth.uid(), but an
--     admin-assigned task (via task_assignments) has tasks.student_id = null
--     - so the second update matches zero rows. Also 204, also silent.
-- The button that calls this was never wired into the UI until today, so
-- this has been broken the whole time nothing exercised it - not a
-- regression from today's auto-grading work, a second latent bug it
-- surfaced.

create or replace function public.start_task_assignment(_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller     uuid := auth.uid();
  profile_id uuid;
  t          record;
  prev       text;
begin
  if caller is null then
    return jsonb_build_object('ok', false, 'reason', 'not authenticated');
  end if;

  select id into profile_id from public.student_profiles where user_id = caller;
  if profile_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no student profile');
  end if;

  select id, student_id into t from public.tasks where id = _task_id;
  if t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no such task');
  end if;

  prev := current_setting('app.system_write', true);
  perform set_config('app.system_write', 'on', true);

  if t.student_id = profile_id then
    -- Direct task, owned outright by this student.
    update public.tasks
       set started_at = coalesce(started_at, now()), status = 'In Progress'
     where id = _task_id and started_at is null;
  else
    -- Assigned task: only this student's own assignment row may move, and
    -- only forward from 'assigned' - never off 'completed' or anything a
    -- reviewer set.
    update public.task_assignments
       set status = 'in_progress', updated_at = now()
     where task_id = _task_id and student_id = profile_id and status = 'assigned';

    if not found then
      perform set_config('app.system_write', coalesce(prev, ''), true);
      return jsonb_build_object('ok', false, 'reason', 'not assigned to you, or already started');
    end if;

    -- Several students can share one assigned task row. started_at here is
    -- just "somebody has begun this" for anything that reads it off tasks
    -- directly; the per-student truth lives on task_assignments.status
    -- above. First starter sets it, a later one does not reset it.
    update public.tasks
       set started_at = coalesce(started_at, now())
     where id = _task_id and started_at is null;
  end if;

  perform set_config('app.system_write', coalesce(prev, ''), true);
  return jsonb_build_object('ok', true);
end
$$;

grant execute on function public.start_task_assignment(uuid) to authenticated;

comment on function public.start_task_assignment(uuid) is
  'The one legitimate way a student moves their own task/assignment from Applied to In Progress. Fenced through app.system_write since both protect_task_assignments and tasks_own_update block a plain student PATCH.';
