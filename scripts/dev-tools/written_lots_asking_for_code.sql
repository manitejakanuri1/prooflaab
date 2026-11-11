-- READ-ONLY. QA round 2 item 1 (11 Nov 2026): Daily Lots that ask for a PROGRAM but were made as WRITTEN
-- Lots (rubric checker, no code editor), e.g. "Build a timed aptitude mock test", "Time and Work Solver".
-- Why it happens: lot-pipeline.ts picks written vs code from the SOURCE PAGE before the Lot is written
-- (guessGradingMode: a code block, or two programming words in the page's title/opening). An aptitude
-- page has neither, so it is "written" - and the model can still word the Lot as "write a program".
-- Changes nothing. Claude runs it on TEST only; the owner runs it on REAL.
with lots as (
  select t.id, t.lot_date, t.lot_number, t.title, t.status, p.full_name, c.name as college,
         t.title || ' ' || coalesce(t.description, '') as txt
    from public.tasks t
    join public.student_profiles p on p.id = t.student_id
    left join public.colleges c on c.id = p.college_id
   where t.lot_date is not null and t.rubric_config_id is not null and t.sandbox_config_id is null
)
select lot_date, lot_number, college, full_name, status, title
  from lots
 where txt ~* '\m(write|build|create|implement|develop|code)\M\s+(a|an|the|your|one)?\s*([a-z-]+\s+){0,4}(program|script|function|application|app|solver|calculator|simulator|cli|command-line tool)\M'
    or txt ~* '\m(python|java|javascript|c\+\+|c) (program|script|function)\M'
 order by lot_date desc, title;

-- The same check on the Lot templates new Lots are copied from (fixing these stops new copies).
select l.source_content_id, l.title
  from public.lot_templates l
 where l.rubric_config_id is not null and l.sandbox_config_id is null
   and (l.title || ' ' || coalesce(l.scenario, '')) ~* '\m(write|build|create|implement|develop|code)\M\s+(a|an|the|your|one)?\s*([a-z-]+\s+){0,4}(program|script|function|application|app|solver|calculator|simulator|cli|command-line tool)\M'
 order by l.title;
