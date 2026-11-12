-- 351 (F18, Grok retest 12 Nov 2026): "First Lot finished" showed while the Portfolio said 0 completed.
-- Done = a passing answer + an accepted (scored, not withdrawn) voice - the rule of portfolio_work and the quests (320).
--   my_achievements counted the "proof" badges from any passed answer (320 changed only its quests), and it runs on
--   every Achievements visit, so it handed out "First Lot finished" for a 10/10 answer whose voice was rejected.
--   record_activity counted tasks.status = 'completed'; it now uses the same done rule.
--   A proof badge already given whose count no longer holds is not deleted (owner rule: ask before deleting); it is
--   left out of 'earned' while the count is short, so it shows again only when it is really earned.
-- Rollback: migration/351-rollback-badges-follow-done-rule.sql
begin;
do $$
declare
  ma constant regprocedure := 'public.my_achievements()'::regprocedure;
  ra constant regprocedure := 'public.record_activity(uuid, text)'::regprocedure;
  a1 constant text := 'select count(distinct task_id) into proofs from public.task_submissions where student_id = me and status = ''passed'';';
  b1 constant text := 'select count(distinct s.task_id) into proofs from public.task_submissions s where s.student_id = me and s.status = ''passed'' and exists (select 1 from public.voice_explanations dv where dv.task_id = s.task_id and dv.student_id = me and dv.status = ''scored'' and dv.withdrawn_at is null); -- 351: done Lots only';
  a2 constant text := 'from public.student_badges where student_id = me), ''[]''::jsonb),';
  b2 constant text := 'from public.student_badges sb where sb.student_id = me and not exists (select 1 from public.badges pb where pb.slug = sb.badge_slug and pb.rule_kind = ''proof'' and proofs < pb.rule_value)), ''[]''::jsonb),';
  a3 constant text := 'where s.student_id = _student_id and s.status = ''passed'' and lower(k.status) = ''completed'';';
  b3 constant text := 'where s.student_id = _student_id and s.status = ''passed'' and exists (select 1 from public.voice_explanations dv where dv.task_id = s.task_id and dv.student_id = _student_id and dv.status = ''scored'' and dv.withdrawn_at is null); -- 351: done Lots only';
  def text;
begin
  def := pg_get_functiondef(ma);
  if position(b1 in def) = 0 then
    if position(a1 in def) = 0 or position(a2 in def) = 0 then raise exception '351: my_achievements anchor not found'; end if;
    execute replace(replace(def, a1, b1), a2, b2);
  end if;
  def := pg_get_functiondef(ra);
  if position(b3 in def) = 0 then
    if position(a3 in def) = 0 then raise exception '351: record_activity anchor not found'; end if;
    execute replace(def, a3, b3);
  end if;
  if position(b1 in pg_get_functiondef(ma)) = 0 or position(b2 in pg_get_functiondef(ma)) = 0
     or position(b3 in pg_get_functiondef(ra)) = 0 then
    raise exception '351 self-check failed';
  end if;
  raise notice '351 ok';
end $$;
commit;
notify pgrst, 'reload schema';
