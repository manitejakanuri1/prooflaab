-- 92: LeetCode/HackerRank-style function evaluator foundation.
--
-- Existing stdio rows are not rewritten.
-- FunctionSpec is data only. Executable harness code is never stored here.

begin;

alter table public.task_sandbox_config
  add column if not exists function_spec jsonb;

create or replace function public.function_mode_reserved_names()
returns text[]
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select ARRAY['abstract', 'alignas', 'alignof', 'and', 'append', 'args', 'arguments', 'argv', 'array', 'as', 'asm', 'assert', 'async', 'auto', 'await', 'begin', 'bool', 'boolean', 'break', 'byte', 'callable', 'cap', 'case', 'catch', 'chan', 'char', 'char16_t', 'char32_t', 'char8_t', 'class', 'clear', 'clone', 'close', 'co_await', 'co_return', 'co_yield', 'collections', 'complex', 'concept', 'const', 'consteval', 'constexpr', 'constinit', 'constructor', 'continue', 'copy', 'debugger', 'declare', 'decltype', 'def', 'default', 'defer', 'defined', 'del', 'delete', 'die', 'do', 'double', 'echo', 'elif', 'else', 'elsif', 'empty', 'end', 'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch', 'endwhile', 'ensure', 'enum', 'error', 'eval', 'except', 'exception', 'exit', 'explicit', 'export', 'exports', 'extends', 'extern', 'fallthrough', 'false', 'final', 'finally', 'float', 'fn', 'for', 'foreach', 'friend', 'from', 'func', 'function', 'global', 'go', 'goto', 'if', 'imag', 'implements', 'import', 'in', 'include', 'include_once', 'infinity', 'init', 'inline', 'instanceof', 'insteadof', 'int', 'integer', 'interface', 'iota', 'is', 'isset', 'iterable', 'json', 'lambda', 'len', 'let', 'list', 'long', 'main', 'make', 'map', 'match', 'math', 'max', 'min', 'mixed', 'module', 'mutable', 'namespace', 'nan', 'native', 'never', 'new', 'next', 'nil', 'noexcept', 'none', 'nonlocal', 'not', 'null', 'nullptr', 'number', 'object', 'operator', 'optional', 'or', 'out', 'package', 'panic', 'parent', 'pass', 'payload', 'permits', 'print', 'println', 'private', 'prooflab', 'protected', 'prototype', 'public', 'raise', 'range', 'readonly', 'real', 'record', 'recover', 'redo', 'register', 'require', 'require_once', 'requires', 'rescue', 'restrict', 'result', 'retry', 'return', 'rune', 'runtimeexception', 'scanner', 'sealed', 'select', 'self', 'short', 'signed', 'sizeof', 'static', 'std', 'stderr', 'stdin', 'stdout', 'strictfp', 'string', 'struct', 'super', 'switch', 'synchronized', 'system', 'template', 'then', 'this', 'thread', 'thread_local', 'throw', 'throws', 'trait', 'transient', 'true', 'try', 'type', 'typedef', 'typeid', 'typename', 'typeof', 'undef', 'undefined', 'union', 'unless', 'unset', 'unsigned', 'until', 'using', 'value', 'var', 'virtual', 'void', 'volatile', 'wchar_t', 'when', 'while', 'with', 'write', 'xor', 'yield']::text[];
$$;

revoke all on function public.function_mode_reserved_names()
  from public, anon;
grant execute on function public.function_mode_reserved_names()
  to authenticated, service_role;

create or replace function public.function_spec_ok(_s jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  p jsonb;
  fname text;
  cname text;
  pname text;
  ptype text;
  seen text[] := ARRAY[]::text[];
  n integer;
  allowed_types constant text[] := ARRAY[
    'integer',
    'number',
    'boolean',
    'string',
    'array<integer>',
    'array<number>',
    'array<boolean>',
    'array<string>'
  ]::text[];
begin
  if _s is null or jsonb_typeof(_s) <> 'object' then
    return false;
  end if;

  if not (_s ? 'function_name' and _s ? 'parameters' and _s ? 'return_type') then
    return false;
  end if;

  if exists (
    select 1
      from jsonb_object_keys(_s) k
     where k not in ('function_name','class_name','parameters','return_type')
  ) then
    return false;
  end if;

  if jsonb_typeof(_s->'function_name') <> 'string' then
    return false;
  end if;

  fname := _s->>'function_name';

  if char_length(fname) > 64
     or fname !~ '^[a-z][A-Za-z0-9]*$'
     or lower(fname) = any(public.function_mode_reserved_names())
     or lower(fname) like '__prooflab%'
     or lower(fname) like '__pl%' then
    return false;
  end if;

  cname := null;

  if _s ? 'class_name' and _s->'class_name' <> 'null'::jsonb then
    if jsonb_typeof(_s->'class_name') <> 'string' then
      return false;
    end if;

    cname := _s->>'class_name';

    if char_length(cname) > 64
       or cname !~ '^[A-Z][A-Za-z0-9]*$'
       or lower(cname) = any(public.function_mode_reserved_names())
       or lower(cname) like '__prooflab%'
       or lower(cname) like '__pl%' then
      return false;
    end if;
  end if;

  if jsonb_typeof(_s->'parameters') <> 'array' then
    return false;
  end if;

  if jsonb_array_length(_s->'parameters') > 8 then
    return false;
  end if;

  for p in select value from jsonb_array_elements(_s->'parameters')
  loop
    if jsonb_typeof(p) <> 'object' then
      return false;
    end if;

    select count(*) into n from jsonb_object_keys(p);

    if n <> 2 or not (p ? 'name' and p ? 'type') then
      return false;
    end if;

    if jsonb_typeof(p->'name') <> 'string'
       or jsonb_typeof(p->'type') <> 'string' then
      return false;
    end if;

    pname := p->>'name';
    ptype := p->>'type';

    if char_length(pname) > 64
       or pname !~ '^[a-z][A-Za-z0-9]*$'
       or lower(pname) = any(public.function_mode_reserved_names())
       or lower(pname) like '__prooflab%'
       or lower(pname) like '__pl%' then
      return false;
    end if;

    if lower(pname) = any(seen)
       or lower(pname) = lower(fname)
       or (cname is not null and lower(pname) = lower(cname)) then
      return false;
    end if;

    if not (ptype = any(allowed_types)) then
      return false;
    end if;

    seen := array_append(seen, lower(pname));
  end loop;

  if jsonb_typeof(_s->'return_type') <> 'string'
     or not ((_s->>'return_type') = any(allowed_types)) then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function public.function_spec_ok(jsonb)
  from public, anon;
grant execute on function public.function_spec_ok(jsonb)
  to authenticated, service_role;

alter table public.task_sandbox_config
  drop constraint if exists task_sandbox_config_kind_check;

alter table public.task_sandbox_config
  drop constraint if exists task_sandbox_config_function_spec_check;

alter table public.task_sandbox_config
  add constraint task_sandbox_config_kind_check
  check (kind in ('stdio', 'function'));

alter table public.task_sandbox_config
  add constraint task_sandbox_config_function_spec_check
  check (
    (kind = 'stdio' and function_spec is null)
    or
    (
      kind = 'function'
      and function_spec is not null
      and public.function_spec_ok(function_spec)
    )
  );

-- Once an evaluator has graded evidence, every field that can affect a future
-- verdict is immutable. This is migration 57's behaviour extended only for the
-- sandbox tuple; the rubric branch stays unchanged.
create or replace function public.freeze_used_evaluator()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'task_sandbox_config' then
    if (
         new.test_cases,
         new.reference_solution,
         new.language,
         new.kind,
         new.function_spec,
         new.time_limit_ms,
         new.memory_limit_mb,
         new.pass_threshold
       )
       is distinct from
       (
         old.test_cases,
         old.reference_solution,
         old.language,
         old.kind,
         old.function_spec,
         old.time_limit_ms,
         old.memory_limit_mb,
         old.pass_threshold
       )
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

-- Students may see the callable signature and visible examples.
-- Hidden tests and reference_solution remain unreachable through this RPC.
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

revoke all on function public.sandbox_task_view(uuid)
  from public, anon;
grant execute on function public.sandbox_task_view(uuid)
  to authenticated;

do $$
declare
  freeze_def text;
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.task_sandbox_config'::regclass
       and contype = 'c'
       and conname not in (
         'task_sandbox_config_kind_check',
         'task_sandbox_config_function_spec_check'
       )
       and pg_get_constraintdef(oid) ~ '\mkind\M'
  ) then
    raise exception
      '92 self-check: an old kind CHECK is still present';
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.task_sandbox_config'::regclass
       and conname = 'task_sandbox_config_kind_check'
       and pg_get_constraintdef(oid) ilike '%function%'
  ) then
    raise exception
      '92 self-check: new stdio/function kind CHECK missing';
  end if;

  if exists (
    select 1
      from public.task_sandbox_config
     where kind = 'stdio'
       and function_spec is not null
  ) then
    raise exception
      '92 self-check: stdio row unexpectedly has function_spec';
  end if;

  select pg_get_functiondef(
    'public.freeze_used_evaluator'::regproc
  ) into freeze_def;

  if position('function_spec' in freeze_def) = 0
     or position('time_limit_ms' in freeze_def) = 0
     or position('memory_limit_mb' in freeze_def) = 0
     or position('pass_threshold' in freeze_def) = 0 then
    raise exception
      '92 self-check: frozen sandbox tuple is incomplete';
  end if;

  raise notice
    '92: function evaluator contract, freeze rules and student view installed';
end
$$;

notify pgrst, 'reload schema';

commit;
