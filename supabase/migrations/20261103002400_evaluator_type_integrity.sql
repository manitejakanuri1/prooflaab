-- 74: a task's grading TYPE is declared and enforced, not inferred after the fact (G2).
-- Until now the rules were: exactly one of sandbox_config_id / rubric_config_id, and a task
-- with neither silently received the generic written checklist. Nothing let a creator say
-- "this is a CODING task", so a coding task that lost its tests would quietly be graded as a
-- written answer.
--   tasks.grading_type ('coding' | 'written') is the declared type:
--     coding  -> sandbox_config_id required; the generic checklist is NEVER attached; refused otherwise
--     written -> rubric_config_id required (its own, or the generic checklist when it has none)
--   A creator that does not declare a type gets the type its evaluator implies (unchanged
--   behaviour for existing creators); a creator that declares one is held to it.
--   (is_sandbox_task is an existing computed column and keeps agreeing by construction.)
-- Creators audited: create_lot_for (copies the Lot template's evaluator), company_create_lot
-- (validated tests or its own rubric), assign_tasks function (now declares 'coding' for the
-- Coding category), resume-assessment-submit roadmap tasks and level-quiz-submit (written).
-- sponsor_lot() had no caller left and created tasks with no specific evaluator: dropped.
begin;

do $$
declare bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prokind = 'f' and p.proname <> 'sponsor_lot' and p.prosrc ~ '\msponsor_lot\s*\(';
  if bad is not null then raise exception '74: sponsor_lot still has callers: %', bad; end if;
end $$;

alter table public.tasks add column if not exists grading_type text;

create or replace function public.task_default_checker()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if new.grading_type = 'coding' and new.sandbox_config_id is null then
    raise exception 'A coding task needs its tests (sandbox_config_id). It was not created.'
      using hint = 'evaluator_type_mismatch';
  end if;
  if new.grading_type = 'written' and new.sandbox_config_id is not null then
    raise exception 'A written task cannot be graded by code tests.' using hint = 'evaluator_type_mismatch';
  end if;
  if new.sandbox_config_id is null and new.rubric_config_id is null then
    -- Written work with no checker of its own: the generic checklist. Never for coding (refused above).
    new.rubric_config_id := (select id from public.task_rubric_config where is_generic_fallback limit 1);
  end if;
  new.grading_type := case when new.sandbox_config_id is not null then 'coding' else 'written' end;
  return new;
end $function$;

drop trigger if exists task_default_checker on public.tasks;
-- Existing rows get their type from their evaluator (the trigger is not attached yet).
select set_config('app.system_write', 'on', true);
update public.tasks set grading_type = case when sandbox_config_id is not null then 'coding' else 'written' end
 where grading_type is null;

create trigger task_default_checker before insert or update of sandbox_config_id, rubric_config_id, grading_type
  on public.tasks for each row execute function public.task_default_checker();

alter table public.tasks alter column grading_type set not null;
alter table public.tasks drop constraint if exists tasks_grading_type_matches;
alter table public.tasks add constraint tasks_grading_type_matches
  check (grading_type in ('coding', 'written')
         and (grading_type = 'coding') = (sandbox_config_id is not null)
         and (grading_type = 'coding' or rubric_config_id is not null));

drop function if exists public.sponsor_lot(uuid, text, text, text, integer);

do $$
declare n bigint; t uuid; s uuid := (select id from public.student_profiles limit 1);
begin
  select count(*) into n from public.tasks
   where (grading_type = 'coding') is distinct from (sandbox_config_id is not null)
      or num_nonnulls(sandbox_config_id, rubric_config_id) <> 1;
  if n > 0 then raise exception '74 self-check: % tasks break the evaluator-type rule', n; end if;

  -- A declared coding task without tests must be refused, not downgraded to the generic checklist.
  begin
    insert into public.tasks (student_id, title, grading_type) values (s, '74 self-check coding without tests', 'coding');
    raise exception '74 self-check: a coding task without tests was accepted';
  exception when others then
    if sqlerrm not like '%needs its tests%' then raise; end if;
  end;
  -- An undeclared task with no checker is written and gets a written checker.
  insert into public.tasks (student_id, title) values (s, '74 self-check written') returning id into t;
  if (select grading_type <> 'written' or rubric_config_id is null from public.tasks where id = t) then
    raise exception '74 self-check: a written task did not get a written checker';
  end if;
  delete from public.tasks where id = t;
end $$;

commit;

notify pgrst, 'reload schema';
