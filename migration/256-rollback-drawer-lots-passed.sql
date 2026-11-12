-- Rollback for 256.
begin;
do $$ begin
  execute replace(pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure),
    '''auto_graded_passed'', (select count(distinct task_id) from public.task_submissions',
    '''auto_graded_passed'', (select count(*) from public.task_submissions');
end $$;
commit;
