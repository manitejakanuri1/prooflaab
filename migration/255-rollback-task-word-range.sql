-- Rollback for 255: rubric_task_view returns the stored range again; drops task_word_range.
begin;
CREATE OR REPLACE FUNCTION public.rubric_task_view(_task_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'task_id', t.id,
    'title', t.title,
    'prompt_text', c.prompt_text,
    'criteria', c.criteria,
    'min_words', c.min_words,
    'max_words', c.max_words,
    'pass_threshold', c.pass_threshold,
    'scratch_language', c.scratch_language,
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
$function$;
drop function if exists public.task_word_range(text, text, integer, integer);
notify pgrst, 'reload schema';
commit;
