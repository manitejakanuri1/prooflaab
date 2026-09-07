-- ============================================================================
-- Stage 44 — fix tasks_assigned_read: it never actually checked the task.
--
-- Found via live inspection of pg_policies, not a code read:
--
--   EXISTS (SELECT 1 FROM task_assignments a
--            WHERE a.task_id = a.id AND a.student_id = auth.uid())
--
-- a.task_id = a.id compares a task_assignments row to itself and is always
-- false (task_id references tasks.id; id is task_assignments' own primary
-- key - two different UUID sequences). The outer `tasks` row being checked
-- was never referenced at all.
--
-- Effect: assign_tasks (what Admin's Assign Tasks always calls) inserts one
-- tasks row with no student_id, then one task_assignments row per student.
-- The student's task list embeds tasks:task_id(...) inside a task_assignments
-- query - an embed still has to pass the embedded table's own RLS. With this
-- policy dead, that embed silently returned null for any admin-assigned task
-- whose visibility was not 'public' (tasks_read's own visibility='public'
-- clause was the only thing accidentally covering the rest). A privately
-- assigned admin task was invisible to the student it was assigned to.
-- ============================================================================

drop policy tasks_assigned_read on public.tasks;

create policy tasks_assigned_read on public.tasks for select to authenticated
  using (
    exists (
      select 1 from public.task_assignments a
       where a.task_id = tasks.id
         and a.student_id = (select auth.uid())
    )
  );
