-- 226 (language choice, 11 Nov 2026): a "read input, print output" coding Lot can be answered in Python, Java,
-- C, C++ or JavaScript. sandbox_languages(task) is the one rule, used by the Lot screen (sandbox_task_view
-- 'languages') and by run-sandbox / submit-sandbox-task, which refuse any other language.
-- Rule: the 5 languages when the checker is stdio (not "write this function"), its own language is one of the 5,
-- and the source page title does not name a language (a page about Python or JavaScript keeps its language).
-- Otherwise only the Lot's own language. Tests, scores and task text are unchanged.
-- Rollback: migration/226-rollback-language-choice.sql
begin;

-- ponytail: title word match only; a language page whose title never says the language (e.g. the Python docs
-- page "4. More Control Flow Tools") still gets the menu. Add a per-page flag if those must stay locked.
create or replace function public.sandbox_languages(_task_id uuid)
returns text[]
language sql
stable
set search_path = public, pg_temp
as $$
  select case
           when c.kind is distinct from 'function'
            and c.language in ('python', 'java', 'c', 'cpp', 'javascript')
            and coalesce(sc.title, '') !~* '(^|[^a-z0-9+#])(python|java|javascript|typescript|c\+\+|c#|golang|kotlin|ruby|php|rust|swift|sql)($|[^a-z0-9+#])'
           then array['python', 'java', 'c', 'cpp', 'javascript']
           else array[c.language]
         end
    from public.tasks t
    join public.task_sandbox_config c on c.id = t.sandbox_config_id
    left join public.source_content sc on sc.id = t.source_content_id
   where t.id = _task_id;
$$;
revoke all on function public.sandbox_languages(uuid) from public, anon;
grant execute on function public.sandbox_languages(uuid) to authenticated, service_role;

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
    'languages', public.sandbox_languages(t.id),
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
revoke all on function public.sandbox_task_view(uuid) from public, anon;
grant execute on function public.sandbox_task_view(uuid) to authenticated;

do $$
begin
  if position('''languages''' in pg_get_functiondef('public.sandbox_task_view'::regproc)) = 0 then
    raise exception '226 self-check: sandbox_task_view has no languages';
  end if;
  if exists (select 1 from public.tasks t
              where t.sandbox_config_id is not null and cardinality(public.sandbox_languages(t.id)) not in (1, 5)) then
    raise exception '226 self-check: unexpected language list';
  end if;
  if exists (select 1 from public.tasks t join public.task_sandbox_config c on c.id = t.sandbox_config_id
              where c.kind = 'function' and public.sandbox_languages(t.id) <> array[c.language]) then
    raise exception '226 self-check: a function Lot got a language menu';
  end if;
  if 'Array methods chaining - x/2-js-basics' !~* '(^|[^a-z0-9+#])(python|java|javascript)($|[^a-z0-9+#])'
     and 'QA test - Python list comprehensions' ~* '(^|[^a-z0-9+#])(python|java|javascript)($|[^a-z0-9+#])' then
    null;
  else
    raise exception '226 self-check: title rule';
  end if;
  raise notice '226: % coding tasks, % with the 5-language menu',
    (select count(*) from public.tasks where sandbox_config_id is not null),
    (select count(*) from public.tasks where sandbox_config_id is not null and cardinality(public.sandbox_languages(id)) = 5);
end
$$;

commit;
notify pgrst, 'reload schema';
