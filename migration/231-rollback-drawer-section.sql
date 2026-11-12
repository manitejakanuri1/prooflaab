-- Rollback for 231: drop 'cohort' from tpo_student_profile again.
begin;
do $$ begin
  execute replace(pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure), '''branch'', p.branch, ''cohort'', p.cohort,', '''branch'', p.branch,');
end $$;
commit;
