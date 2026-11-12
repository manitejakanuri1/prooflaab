-- Rollback for 257.
begin;
do $$ begin
  execute replace(pg_get_functiondef('public.recruiter_home()'::regprocedure),
    'where t.sponsored_by = rid and not exists (select 1 from public.task_submissions ts where ts.task_id = t.id))',
    'where t.sponsored_by = rid and t.status = ''pending'')');
end $$;
drop function if exists public.sponsor_company(public.tasks);
notify pgrst, 'reload schema';
commit;
