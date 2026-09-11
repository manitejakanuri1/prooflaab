-- stage70d: task_rubric_config is admin-only RLS (task_rubric_config_admin_all),
-- so a student embedding tasks -> task_rubric_config through PostgREST gets
-- nothing back. rubric_task_view() is sandbox_task_view()'s counterpart: a
-- security-definer function that hands a student only what they need to
-- answer (prompt, criteria, word bounds, pass mark) — never reference_answer.

begin;

create or replace function public.rubric_task_view(_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'task_id', t.id,
    'title', t.title,
    'prompt_text', c.prompt_text,
    'criteria', c.criteria,
    'min_words', c.min_words,
    'max_words', c.max_words,
    'pass_threshold', c.pass_threshold,
    'completed', exists (
      select 1 from public.task_submissions s
       where s.task_id = t.id and s.student_id = auth.uid() and s.status = 'passed'),
    'pending_review', exists (
      select 1 from public.task_submissions s
       where s.task_id = t.id and s.student_id = auth.uid() and s.status = 'needs_review'),
    'attempts', (
      select count(*) from public.task_submissions s
       where s.task_id = t.id and s.student_id = auth.uid())
  )
  from public.tasks t
  join public.task_rubric_config c on c.id = t.rubric_config_id
  where t.id = _task_id
    and (t.student_id = auth.uid()
         or exists (select 1 from public.task_assignments a
                     where a.task_id = t.id and a.student_id = auth.uid()));
$$;

revoke all on function public.rubric_task_view(uuid) from public, anon;
grant execute on function public.rubric_task_view(uuid) to authenticated;

comment on function public.rubric_task_view(uuid) is
  'Student-safe read of a rubric-graded task: prompt, criteria, word bounds. Never reference_answer. task_rubric_config itself is admin-only RLS, so this is the only way a student sees the question.';

commit;
