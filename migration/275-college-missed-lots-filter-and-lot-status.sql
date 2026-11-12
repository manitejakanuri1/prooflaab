-- 275 (owner E2E 12 Nov 2026, college items 8 and 10):
--   8) Home "50 students missed this week's Lot" -> View opened Students with filter 'missed_lots', which
--      tpo_students did not know, so the list was empty. tpo_students now filters on tpo_attention's reason code.
--  10) The drawer's "Recent work" showed the LATEST try's result ("Not passed") for a Lot an earlier try had
--      passed, while "Lots passed" counted it. A Lot with any passed try now reads "passed", and the task's own
--      status is sent (task_status) so the drawer can say "voice owed" - the same words as the header (256).
-- Rollback: migration/275-rollback-college-missed-lots-filter-and-lot-status.sql
begin;
do $$
declare
  ts  constant regprocedure := 'public.tpo_students(text,text,text,text,text,text,integer,integer)'::regprocedure;
  tp  constant regprocedure := 'public.tpo_student_profile(uuid)'::regprocedure;
  def text;
  a1 constant text := 'select a.student_id, a.severity from public.tpo_attention() a';
  b1 constant text := 'select a.student_id, a.severity, a.reason_codes from public.tpo_attention() a';
  a2 constant text := 'coalesce(att.severity, ''ok'') as attn,';
  b2 constant text := 'coalesce(att.severity, ''ok'') as attn, coalesce(att.reason_codes, ''{}''::text[]) as codes,';
  a3 constant text := 'or (_status = ''active_week''  and b.quiet <= 7))';
  b3 constant text := 'or (_status = ''active_week''  and b.quiet <= 7) or (_status = ''missed_lots'' and ''missed_lots'' = any(b.codes)))';
  a4 constant text := 'select distinct on (s.task_id) s.id, null::text as file_name, s.status,';
  b4 constant text := 'select distinct on (s.task_id) s.id, null::text as file_name, case when exists (select 1 from public.task_submissions y where y.student_id = p.id and y.task_id = s.task_id and y.status = ''passed'') then ''passed'' else s.status end as status, (select t2.status from public.tasks t2 where t2.id = s.task_id) as task_status,';
begin
  def := pg_get_functiondef(ts);
  if position(b3 in def) = 0 then
    if position(a1 in def) = 0 or position(a2 in def) = 0 or position(a3 in def) = 0 then raise exception '275: tpo_students anchor not found'; end if;
    execute replace(replace(replace(def, a1, b1), a2, b2), a3, b3);
  end if;
  def := pg_get_functiondef(tp);
  if position(b4 in def) = 0 then
    if position(a4 in def) = 0 then raise exception '275: tpo_student_profile anchor not found'; end if;
    execute replace(def, a4, b4);
  end if;
  if position(b3 in pg_get_functiondef(ts)) = 0 or position(b4 in pg_get_functiondef(tp)) = 0 then
    raise exception '275 self-check failed';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
