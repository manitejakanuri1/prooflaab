-- Rollback of 56. Deploy the previous functions image and website first.
begin;
grant execute on function public.sponsor_lot(uuid, text, text, text, integer) to authenticated;
drop function if exists public.company_create_lot(uuid, uuid[], text, text, text, text, integer, uuid, uuid, text, integer, text);
alter table public.tasks drop constraint if exists tasks_have_evaluator;
-- the generic checklist seeded by 56 (only where none existed) is left in place: tasks may reference it.
do $$ begin raise notice '56 rolled back'; end $$;
commit;
notify pgrst, 'reload schema';
