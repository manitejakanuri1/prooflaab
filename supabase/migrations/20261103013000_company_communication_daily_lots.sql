-- 140: the company "Communication" score averages daily Lot voices only; the portfolio lists every passed task again.
-- Owner decision, 24 Oct 2026.
--
--   1. recruiter_proof_profile(): 'communication' counts only the voice explanation of a daily Lot
--      (tasks.source = 'daily_lot'), the same voices the company sees in the Lots box (migration 139).
--      College and admin "Voice score" (tpo_student_profile) still count every voice; not touched.
--   2. portfolio_work(): undoes part 2 of migration 139, so the student's portfolio shows roadmap tasks again.
-- Rollback: migration/140-rollback-company-communication-daily-lots.sql
begin;

do $$
declare
  f   regprocedure := 'public.recruiter_proof_profile(uuid)'::regprocedure;
  def text := pg_get_functiondef(f);
  c_old constant text := $a$where v.student_id = p.id and v.communication_score is not null$a$;
  c_new constant text := $a$where v.student_id = p.id and v.communication_score is not null
                         and exists (select 1 from public.tasks dl where dl.id = v.task_id and dl.source = 'daily_lot')$a$;
  p_old constant text := $a$
     and t.source in ('daily_lot', 'sponsored')$a$;
begin
  if (length(def) - length(replace(def, c_old, ''))) / length(c_old) <> 1 then
    raise exception '140: recruiter_proof_profile is not the version this migration expects';
  end if;
  execute replace(def, c_old, c_new);

  f := 'public.portfolio_work(uuid)'::regprocedure;
  def := pg_get_functiondef(f);
  if (length(def) - length(replace(def, p_old, ''))) / length(p_old) <> 1 then
    raise exception '140: portfolio_work is not the 139 version';
  end if;
  execute replace(def, p_old, '');
end $$;

do $$
begin
  if position($a$dl.id = v.task_id and dl.source = 'daily_lot'$a$ in pg_get_functiondef('public.recruiter_proof_profile(uuid)'::regprocedure)) = 0
     or position('daily_lot' in pg_get_functiondef('public.portfolio_work(uuid)'::regprocedure)) > 0 then
    raise exception '140: not applied as written';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
