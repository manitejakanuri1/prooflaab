-- READ ONLY (QA round 2 item 20, 11 Nov 2026). Coding Lots whose hidden tests feed input (stdin) while the script
-- the student is given never reads input, and the task text never says "read the input". Such a Lot cannot be
-- passed by following its own steps (REAL student 09, LOT #013 "Split a growing script into an importable module").
-- Function-style checkers (function_spec set) pass arguments, not stdin, and are left out. Changes nothing.
\pset pager off
with cfg as (
  select c.id, c.language, coalesce(c.starter_code, '') as starter,
         (select count(*) from jsonb_array_elements(c.test_cases) e where coalesce(e ->> 'stdin', '') <> '') as stdin_tests,
         (select e ->> 'stdin' from jsonb_array_elements(c.test_cases) e where coalesce(e ->> 'stdin', '') <> '' limit 1) as sample_stdin
    from public.task_sandbox_config c
   where c.function_spec is null
), reads as (
  select cfg.*,
         -- python, javascript/node, java, c/c++, go
         (cfg.starter ~* '(input\s*\(|sys\.stdin|readline|readlines|process\.stdin|readFileSync\(\s*(0|''/dev/stdin'')|Scanner\s*\(|BufferedReader|cin\s*>>|scanf|getline|bufio\.)') as starter_reads
    from cfg
), lots as (
  select 'template' as kind, lt.id, lt.title, lt.scenario || ' ' || coalesce(lt.code_sample, '') as text, lt.code_sample, lt.sandbox_config_id
    from public.lot_templates lt where lt.sandbox_config_id is not null
  union all
  select 'task', t.id, t.title, coalesce(t.description, '') || ' ' || coalesce(t.code_sample, ''), t.code_sample, t.sandbox_config_id
    from public.tasks t where t.sandbox_config_id is not null and t.source = 'daily_lot'
)
select l.kind, left(l.id::text, 8) as id, left(l.title, 60) as title, r.language, r.stdin_tests,
       left(replace(r.sample_stdin, E'\n', ' / '), 40) as sample_stdin,
       (l.text ~* '(read (the |its |from )?(input|stdin)|from (standard )?input|input\(\)|stdin|each line of input|first line)') as text_says_read_input,
       (coalesce(l.code_sample, '') ~* '(input\s*\(|sys\.stdin|readline|process\.stdin|Scanner|cin\s*>>|scanf)') as given_code_reads
  from lots l join reads r on r.id = l.sandbox_config_id
 where r.stdin_tests > 0 and not r.starter_reads
   and not (coalesce(l.code_sample, '') ~* '(input\s*\(|sys\.stdin|readline|process\.stdin|Scanner|cin\s*>>|scanf)')
 order by l.kind, (l.text ~* '(read (the |its |from )?(input|stdin)|from (standard )?input|stdin)'), l.title;
