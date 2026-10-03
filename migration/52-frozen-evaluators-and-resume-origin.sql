-- 52: evaluators are frozen once used, and the resume coding round uses the shared engine.
--
-- 1. task_sandbox_config.origin may be 'resume': resume coding problems are now
--    generated and validated by the same engine as Daily Lots (auto-config.ts +
--    test-quality.ts) and stored here, admin-only, instead of inline on
--    resume_assessments (where students could read them, N20).
-- 2. Versioning by immutability: a sandbox config's tests, reference solution or
--    language, and a rubric config's criteria / reference answer / prompt, cannot
--    change once any submission has been graded with it. A change means a NEW
--    config row, so every task_submissions row (and resume coding result) points
--    at exactly the evaluator that graded it. Nothing in the app edits these in
--    place today (checked 3 Oct 2026); this makes it impossible.
--
-- Rollback: migration/52-rollback-frozen-evaluators.sql
begin;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.task_sandbox_config'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%origin%'
  loop
    execute format('alter table public.task_sandbox_config drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.task_sandbox_config
  add constraint task_sandbox_config_origin_check
  check (origin in ('manual', 'auto', 'auto_fallback', 'resume'));

create or replace function public.freeze_used_evaluator()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'task_sandbox_config' then
    if (new.test_cases, new.reference_solution, new.language)
         is distinct from (old.test_cases, old.reference_solution, old.language)
       and exists (select 1 from public.task_submissions s where s.sandbox_config_id = old.id) then
      raise exception 'evaluator % has graded submissions and is frozen; create a new config instead', old.id
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

drop trigger if exists freeze_used_evaluator on public.task_sandbox_config;
create trigger freeze_used_evaluator before update on public.task_sandbox_config
  for each row execute function public.freeze_used_evaluator();
drop trigger if exists freeze_used_evaluator on public.task_rubric_config;
create trigger freeze_used_evaluator before update on public.task_rubric_config
  for each row execute function public.freeze_used_evaluator();

do $$
declare used_id uuid; ok boolean := false;
begin
  -- 'resume' is now an allowed origin
  if not exists (select 1 from pg_constraint where conname = 'task_sandbox_config_origin_check'
                  and pg_get_constraintdef(oid) ilike '%resume%') then
    raise exception 'origin check does not allow resume';
  end if;
  -- a used rubric (if any exists) refuses a criteria change; scratch_language stays editable
  select rubric_config_id into used_id from public.task_submissions where rubric_config_id is not null limit 1;
  if used_id is not null then
    begin
      update public.task_rubric_config set reference_answer = reference_answer || ' ' where id = used_id;
    exception when check_violation then ok := true;
    end;
    if not ok then raise exception 'a used rubric could still be changed'; end if;
    update public.task_rubric_config set scratch_language = scratch_language where id = used_id;
  end if;
  raise notice '52: evaluators frozen once used; resume origin allowed';
end $$;

commit;
notify pgrst, 'reload schema';
