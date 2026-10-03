-- Rollback of 77: only together with 74 (74-rollback restores the shared function).
drop trigger if exists lot_template_default_checker on public.lot_templates;
create trigger lot_template_default_checker before insert on public.lot_templates
  for each row execute function public.task_default_checker();
drop function if exists public.lot_template_default_checker();
