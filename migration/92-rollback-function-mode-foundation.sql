-- Rollback for migration 92.
--
-- IMPORTANT REHEARSAL/OPERATOR ORDER:
-- 1. Roll back the application/functions image that reads kind/function_spec.
-- 2. This SQL refuses to continue while any kind='function' config exists.
-- 3. After a successful rollback, remove the migration ledger row before a
--    rehearsal re-apply:
--      delete from public.schema_migrations
--       where version = '92-function-mode-foundation';
-- 4. Re-apply only through scripts/migrations.py wrap.

begin;

do $$
begin
  if exists (
    select 1
      from public.task_sandbox_config
     where kind = 'function'
  ) then
    raise exception
      '92 rollback refused: function evaluators exist; migrate/delete them explicitly first';
  end if;
end
$$;

-- Restore the pre-92 student view exactly.
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
    'language', c.language,
    'starter_code', c.starter_code,
    'constraints', c.constraints_text,
    'pass_threshold', c.pass_threshold,
    'time_limit_ms', c.time_limit_ms,
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

revoke all on function public.sandbox_task_view(uuid)
  from public, anon;
grant execute on function public.sandbox_task_view(uuid)
  to authenticated;

-- Verbatim migration-57 freeze behaviour.
create or replace function public.freeze_used_evaluator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'task_sandbox_config' then
    if (new.test_cases, new.reference_solution, new.language)
         is distinct from
       (old.test_cases, old.reference_solution, old.language)
       and (
         exists (
           select 1
             from public.task_submissions s
            where s.sandbox_config_id = old.id
         )
         or exists (
           select 1
             from public.resume_assessments ra,
                  jsonb_array_elements(
                    coalesce(ra.coding_questions, '[]'::jsonb)
                  ) q
            where q->>'sandbox_config_id' = old.id::text
              and coalesce(ra.coding_results, '{}'::jsonb) ? (q->>'id')
         )
       ) then
      raise exception
        'evaluator % has graded answers and is frozen; create a new config instead',
        old.id
        using errcode = 'check_violation';
    end if;
  else
    if (new.criteria, new.reference_answer, new.prompt_text)
         is distinct from
       (old.criteria, old.reference_answer, old.prompt_text)
       and exists (
         select 1
           from public.task_submissions s
          where s.rubric_config_id = old.id
       ) then
      raise exception
        'rubric % has graded submissions and is frozen; create a new config instead',
        old.id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.freeze_used_evaluator()
  from public, anon, authenticated;

alter table public.task_sandbox_config
  drop constraint if exists task_sandbox_config_function_spec_check;

alter table public.task_sandbox_config
  drop constraint if exists task_sandbox_config_kind_check;

alter table public.task_sandbox_config
  drop column if exists function_spec;

alter table public.task_sandbox_config
  add constraint task_sandbox_config_kind_check
  check (kind in ('stdio'));

drop function if exists public.function_spec_ok(jsonb);
drop function if exists public.function_mode_reserved_names();

notify pgrst, 'reload schema';

commit;
