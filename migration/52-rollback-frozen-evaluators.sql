-- Rollback of 52. Deploy the previous functions image FIRST (it does not create
-- origin='resume' configs); rows already created with origin 'resume' are relabelled 'auto'.
begin;
drop trigger if exists freeze_used_evaluator on public.task_sandbox_config;
drop trigger if exists freeze_used_evaluator on public.task_rubric_config;
drop function if exists public.freeze_used_evaluator();
update public.task_sandbox_config set origin = 'auto' where origin = 'resume';
alter table public.task_sandbox_config drop constraint if exists task_sandbox_config_origin_check;
alter table public.task_sandbox_config
  add constraint task_sandbox_config_origin_check check (origin in ('manual', 'auto', 'auto_fallback'));
do $$ begin raise notice '52 rolled back'; end $$;
commit;
notify pgrst, 'reload schema';
