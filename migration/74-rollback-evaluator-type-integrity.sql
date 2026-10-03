-- Rollback of 74: back to "exactly one evaluator" without the declared-type rule.
-- sponsor_lot() is not restored (it had no caller); its body is in migration history if ever needed.
begin;
alter table public.tasks drop constraint if exists tasks_grading_type_matches;
drop trigger if exists task_default_checker on public.tasks;
create or replace function public.task_default_checker()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if new.sandbox_config_id is null and new.rubric_config_id is null then
    new.rubric_config_id := (select id from public.task_rubric_config where is_generic_fallback limit 1);
  end if;
  return new;
end $function$;
create trigger task_default_checker before insert on public.tasks
  for each row execute function public.task_default_checker();
alter table public.tasks drop column if exists grading_type;
commit;
notify pgrst, 'reload schema';
