-- Rollback of 139 parts 1 and 2 (companies and the portfolio see every passed task again).
-- Part 3, the mock interview feedback repair, is not undone.
begin;
do $$
declare
  f   regprocedure := 'public.recruiter_proof_profile(uuid)'::regprocedure;
  def text := pg_get_functiondef(f);
begin
  def := replace(def, $a$where s.student_id = p.id and s.status = 'passed' and t.source = 'daily_lot'$a$,
                      $a$where s.student_id = p.id and s.status = 'passed'$a$);
  def := replace(def, $a$
           and exists (select 1 from public.tasks dl where dl.id = ve.task_id and dl.source = 'daily_lot')$a$, '');
  execute def;
  f := 'public.portfolio_work(uuid)'::regprocedure;
  execute replace(pg_get_functiondef(f), $a$
     and t.source in ('daily_lot', 'sponsored')$a$, '');
  if position('daily_lot' in pg_get_functiondef('public.recruiter_proof_profile(uuid)'::regprocedure)) > 0
     or position('daily_lot' in pg_get_functiondef('public.portfolio_work(uuid)'::regprocedure)) > 0 then
    raise exception '139 rollback: not fully undone';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
