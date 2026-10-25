-- 139: companies and the public portfolio see daily Lots only; old mock interview feedback shifted back.
-- Owner decision, 23 Oct 2026.
--
--   1. recruiter_proof_profile(): "work" lists only daily Lots (tasks.source = 'daily_lot') and "explanations"
--      only the voice explanation of a daily Lot. Roadmap tasks, the resume test and resume / mock voice are no
--      longer shown to a company. Company (sponsored) Lots keep their own box.
--   2. portfolio_work(): only daily Lots and company Lots (source 'daily_lot' / 'sponsored').
--   3. mock_interviews: mock-interview-score read the AI's per-question numbers from 0 while the AI numbered
--      them from 1, so each feedback line sat one question too low and the first said "not scored". Interviews
--      saved that way (first answer unscored, every other one scored) get each line moved up one; the last
--      question's feedback was never stored and stays "not scored".
-- Rollback: migration/139-rollback-company-sees-daily-lots-only.sql (1 and 2 only; 3 is a data repair).
begin;

do $$
declare
  f   regprocedure := 'public.recruiter_proof_profile(uuid)'::regprocedure;
  def text := pg_get_functiondef(f);
  w_old constant text := $a$where s.student_id = p.id and s.status = 'passed'$a$;
  w_new constant text := $a$where s.student_id = p.id and s.status = 'passed' and t.source = 'daily_lot'$a$;
  v_old constant text := $a$where ve.student_id = p.id and ve.communication_score is not null$a$;
  v_new constant text := $a$where ve.student_id = p.id and ve.communication_score is not null
           and exists (select 1 from public.tasks dl where dl.id = ve.task_id and dl.source = 'daily_lot')$a$;
  p_old constant text := $a$and s.status = 'passed'
     and s.created_at$a$;
  p_new constant text := $a$and s.status = 'passed'
     and t.source in ('daily_lot', 'sponsored')
     and s.created_at$a$;
begin
  if (length(def) - length(replace(def, w_old, ''))) / length(w_old) <> 1
     or (length(def) - length(replace(def, v_old, ''))) / length(v_old) <> 1 then
    raise exception '139: recruiter_proof_profile is not the version this migration expects';
  end if;
  execute replace(replace(def, w_old, w_new), v_old, v_new);

  f := 'public.portfolio_work(uuid)'::regprocedure;
  def := pg_get_functiondef(f);
  if (length(def) - length(replace(def, p_old, ''))) / length(p_old) <> 1 then
    raise exception '139: portfolio_work is not the version this migration expects';
  end if;
  execute replace(def, p_old, p_new);
end $$;

-- 3. shift the stored per-question feedback of the interviews saved with the off-by-one.
update public.mock_interviews m
   set answers = (
     select jsonb_agg(a || jsonb_build_object('score', coalesce(nxt.b -> 'score', 'null'::jsonb),
                                              'feedback', coalesce(nxt.b -> 'feedback', 'null'::jsonb))
                      order by (a ->> 'n')::int)
       from jsonb_array_elements(m.answers) a
       left join lateral (select b from jsonb_array_elements(m.answers) b
                           where (b ->> 'n')::int = (a ->> 'n')::int + 1) nxt on true)
 where m.status = 'completed' and jsonb_array_length(m.answers) > 1
   and exists (select 1 from jsonb_array_elements(m.answers) a
                where (a ->> 'n')::int = 0 and coalesce(a -> 'score', 'null'::jsonb) = 'null'::jsonb)
   and not exists (select 1 from jsonb_array_elements(m.answers) a
                    where (a ->> 'n')::int > 0 and coalesce(a -> 'score', 'null'::jsonb) = 'null'::jsonb);

do $$
begin
  if position($a$t.source = 'daily_lot'$a$ in pg_get_functiondef('public.recruiter_proof_profile(uuid)'::regprocedure)) = 0
     or position($a$dl.source = 'daily_lot'$a$ in pg_get_functiondef('public.recruiter_proof_profile(uuid)'::regprocedure)) = 0
     or position($a$t.source in ('daily_lot', 'sponsored')$a$ in pg_get_functiondef('public.portfolio_work(uuid)'::regprocedure)) = 0 then
    raise exception '139: not applied as written';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
