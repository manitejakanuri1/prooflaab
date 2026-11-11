-- TEST only (QA round 2 item 20, Purna yes 11 Nov 2026). Adds one step to each coding Lot whose hidden tests feed
-- input (stdin) while the given script never reads it and the text never says to: "Read the input: ...".
-- Only the task text changes (tasks.description, lot_templates.scenario); tests, code and marks do not.
-- The old text is saved first in qa_backup.item20_text. Undo: item20_reword_stdin_lots_undo.sql
-- Same selection as coding_lots_ignore_stdin.sql, which must list 0 Lots afterwards.
\pset pager off
begin;
create schema if not exists qa_backup;
revoke all on schema qa_backup from public;
create table if not exists qa_backup.item20_text (
  kind text not null, id uuid not null, old_text text, saved_at timestamptz not null default now(), primary key (kind, id));

create temp table pick on commit drop as
with cfg as (
  select c.id, c.language, coalesce(c.starter_code, '') as starter,
         (select e ->> 'stdin' from jsonb_array_elements(c.test_cases) e where coalesce(e ->> 'stdin', '') <> '' limit 1) as sample_stdin
    from public.task_sandbox_config c where c.function_spec is null
), lots as (
  select 'template' as kind, lt.id, lt.scenario as body, coalesce(lt.code_sample, '') as code, lt.sandbox_config_id
    from public.lot_templates lt where lt.sandbox_config_id is not null
  union all
  select 'task', t.id, t.description, coalesce(t.code_sample, ''), t.sandbox_config_id
    from public.tasks t where t.sandbox_config_id is not null and t.source = 'daily_lot'
)
select l.kind, l.id, l.body, r.language,
       left(replace(rtrim(r.sample_stdin, E'\n'), E'\n', ' then '), 60) as example
  from lots l join cfg r on r.id = l.sandbox_config_id
 where r.sample_stdin is not null
   and not (r.starter ~* '(input\s*\(|sys\.stdin|readline|readlines|process\.stdin|readFileSync\(\s*(0|''/dev/stdin'')|Scanner\s*\(|BufferedReader|cin\s*>>|scanf|getline|bufio\.)')
   and not (l.code ~* '(input\s*\(|sys\.stdin|readline|process\.stdin|Scanner|cin\s*>>|scanf)')
   and not (coalesce(l.body, '') || ' ' || l.code ~* '\m(read|reads|reading)\M[^.\n]{0,40}\m(input|stdin)\M|\mfrom (standard )?input\M|\mstdin\M');

insert into qa_backup.item20_text (kind, id, old_text) select kind, id, body from pick on conflict do nothing;

create temp table step on commit drop as
select kind, id, E'\nRead the input: your program must read its data from stdin, because the checker types it in (for example: '
       || example || '). '
       || case when language ilike 'python%' then 'In Python use input() or sys.stdin.'
               when language ilike 'java%script%' or language ilike 'node%' then 'In JavaScript use require("fs").readFileSync(0, "utf8").'
               else 'Read it from standard input.' end as line
  from pick;

select set_config('app.system_write', 'on', true);
update public.tasks t set description = coalesce(t.description, '') || s.line from step s where s.kind = 'task' and t.id = s.id;
update public.lot_templates lt set scenario = coalesce(lt.scenario, '') || s.line from step s where s.kind = 'template' and lt.id = s.id;
select kind, count(*) as reworded from pick group by kind;
commit;
