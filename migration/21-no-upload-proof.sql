-- No more "upload proof" (owner's decision, 19 Sep 2026). Every task is done
-- inside ProofLab and checked on the spot: a coding task in the code editor
-- (task_sandbox_config), anything else as a written answer graded against a
-- checklist (task_rubric_config). A task that arrives with neither - roadmap
-- stages, Track proof tasks, college/admin/company tasks, a Lot template that
-- never got one - gets the shared written checklist (is_generic_fallback);
-- the grader reads the task's own title and description alongside it.
begin;

create or replace function public.task_default_checker()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.sandbox_config_id is null and new.rubric_config_id is null then
    new.rubric_config_id := (select id from public.task_rubric_config where is_generic_fallback limit 1);
  end if;
  return new;
end $$;

drop trigger if exists task_default_checker on public.tasks;
create trigger task_default_checker before insert on public.tasks
  for each row execute function public.task_default_checker();

drop trigger if exists lot_template_default_checker on public.lot_templates;
create trigger lot_template_default_checker before insert on public.lot_templates
  for each row execute function public.task_default_checker();

-- Everything already out there that is still open.
update public.tasks
   set rubric_config_id = (select id from public.task_rubric_config where is_generic_fallback limit 1)
 where sandbox_config_id is null and rubric_config_id is null
   and coalesce(lower(status), '') not in ('completed');

update public.lot_templates
   set rubric_config_id = (select id from public.task_rubric_config where is_generic_fallback limit 1)
 where sandbox_config_id is null and rubric_config_id is null;

do $$
begin
  if not exists (select 1 from public.task_rubric_config where is_generic_fallback) then
    raise exception 'no shared written checklist to fall back on';
  end if;
  if exists (select 1 from public.tasks
              where sandbox_config_id is null and rubric_config_id is null
                and coalesce(lower(status), '') not in ('completed')) then
    raise exception 'an open task still has no checker';
  end if;
  if exists (select 1 from public.lot_templates where sandbox_config_id is null and rubric_config_id is null) then
    raise exception 'a Lot template still has no checker';
  end if;
end $$;

commit;
