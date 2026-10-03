-- 57: a resume coding evaluator is frozen once a student's answer was graded with it (§13).
--
-- Migration 52 froze an evaluator once a task_submissions row used it. Resume
-- coding results live in resume_assessments.coding_results (keyed by question id),
-- with the evaluator referenced from coding_questions[].sandbox_config_id - so the
-- staging proof on 3 Oct 2026 showed a graded resume evaluator could still be
-- changed. The freeze now covers both.
--
-- Rollback: re-run the freeze_used_evaluator() body from migration 52.
begin;

create or replace function public.freeze_used_evaluator()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'task_sandbox_config' then
    if (new.test_cases, new.reference_solution, new.language)
         is distinct from (old.test_cases, old.reference_solution, old.language)
       and (exists (select 1 from public.task_submissions s where s.sandbox_config_id = old.id)
            or exists (select 1 from public.resume_assessments ra,
                              jsonb_array_elements(coalesce(ra.coding_questions, '[]'::jsonb)) q
                        where q->>'sandbox_config_id' = old.id::text
                          and coalesce(ra.coding_results, '{}'::jsonb) ? (q->>'id'))) then
      raise exception 'evaluator % has graded answers and is frozen; create a new config instead', old.id
        using errcode = 'check_violation';
    end if;
  else
    if (new.criteria, new.reference_answer, new.prompt_text)
         is distinct from (old.criteria, old.reference_answer, old.prompt_text)
       and exists (select 1 from public.task_submissions s where s.rubric_config_id = old.id) then
      raise exception 'rubric % has graded submissions and is frozen; create a new config instead', old.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.freeze_used_evaluator() from public, anon, authenticated;

do $$
declare used_id uuid; blocked boolean := false;
begin
  select (q->>'sandbox_config_id')::uuid into used_id
    from public.resume_assessments ra, jsonb_array_elements(coalesce(ra.coding_questions, '[]'::jsonb)) q
   where q ? 'sandbox_config_id' and coalesce(ra.coding_results, '{}'::jsonb) ? (q->>'id')
   limit 1;
  if used_id is not null then
    begin
      update public.task_sandbox_config set reference_solution = reference_solution || ' ' where id = used_id;
    exception when check_violation then blocked := true;
    end;
    if not blocked then raise exception 'a graded resume evaluator could still be changed'; end if;
  end if;
  raise notice '57: resume evaluators frozen once graded (checked: %)', coalesce(used_id::text, 'no graded resume round yet');
end $$;

commit;
