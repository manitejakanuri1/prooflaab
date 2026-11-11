-- Rollback of 226: the Lot screen view without 'languages', and no sandbox_languages.
-- Deploy functions without the language check FIRST (they call sandbox_languages).
begin;
create or replace function public.sandbox_task_view(_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'task_id', t.id,
    'title', t.title,
    'description', t.description,
    'kind', c.kind,
    'language', c.language,
    'function_spec',
      case when c.kind = 'function' then c.function_spec else null end,
    'starter_code', c.starter_code,
    'constraints', c.constraints_text,
    'pass_threshold', c.pass_threshold,
    'time_limit_ms', c.time_limit_ms,
    'memory_limit_mb', c.memory_limit_mb,
    'visible_tests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', tc->>'id',
               'stdin', tc->>'stdin',
               'expected_output', tc->>'expected_output'))
        from jsonb_array_elements(c.test_cases) tc
       where coalesce((tc->>'visible')::boolean, false)
    ), '[]'::jsonb),
    'hidden_test_count', (
      select count(*)
        from jsonb_array_elements(c.test_cases) tc
       where not coalesce((tc->>'visible')::boolean, false)
    ),
    'completed', exists (
      select 1
        from public.task_submissions s
       where s.task_id = t.id
         and s.student_id = auth.uid()
         and s.status = 'passed'
    ),
    'attempts', (
      select count(*)
        from public.task_submissions s
       where s.task_id = t.id
         and s.student_id = auth.uid()
    )
  )
  from public.tasks t
  join public.task_sandbox_config c
    on c.id = t.sandbox_config_id
  where t.id = _task_id
    and (
      t.student_id = auth.uid()
      or exists (
        select 1
          from public.task_assignments a
         where a.task_id = t.id
           and a.student_id = auth.uid()
      )
    );
$$;
drop function if exists public.sandbox_languages(uuid);
commit;
notify pgrst, 'reload schema';
