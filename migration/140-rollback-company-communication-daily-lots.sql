-- Rollback of 140: communication counts every voice again; the portfolio goes back to daily and company Lots only.
begin;
do $$
declare
  f   regprocedure := 'public.recruiter_proof_profile(uuid)'::regprocedure;
  def text := pg_get_functiondef(f);
  p_old constant text := $a$and s.status = 'passed'
     and s.created_at$a$;
begin
  execute replace(def, $a$
                         and exists (select 1 from public.tasks dl where dl.id = v.task_id and dl.source = 'daily_lot')$a$, '');
  f := 'public.portfolio_work(uuid)'::regprocedure;
  def := pg_get_functiondef(f);
  if (length(def) - length(replace(def, p_old, ''))) / length(p_old) <> 1 then
    raise exception '140 rollback: portfolio_work is not the 140 version';
  end if;
  execute replace(def, p_old, $a$and s.status = 'passed'
     and t.source in ('daily_lot', 'sponsored')
     and s.created_at$a$);
  if position('dl.id = v.task_id' in pg_get_functiondef('public.recruiter_proof_profile(uuid)'::regprocedure)) > 0 then
    raise exception '140 rollback: not fully undone';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
