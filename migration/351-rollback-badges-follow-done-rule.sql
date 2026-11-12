-- Rollback of 351: puts back the old proof counts in my_achievements and record_activity.
do $$
declare
  ma constant regprocedure := 'public.my_achievements()'::regprocedure;
  ra constant regprocedure := 'public.record_activity(uuid, text)'::regprocedure;
begin
  execute replace(replace(pg_get_functiondef(ma),
    'select count(distinct s.task_id) into proofs from public.task_submissions s where s.student_id = me and s.status = ''passed'' and exists (select 1 from public.voice_explanations dv where dv.task_id = s.task_id and dv.student_id = me and dv.status = ''scored'' and dv.withdrawn_at is null); -- 351: done Lots only',
    'select count(distinct task_id) into proofs from public.task_submissions where student_id = me and status = ''passed'';'),
    'from public.student_badges sb where sb.student_id = me and not exists (select 1 from public.badges pb where pb.slug = sb.badge_slug and pb.rule_kind = ''proof'' and proofs < pb.rule_value)), ''[]''::jsonb),',
    'from public.student_badges where student_id = me), ''[]''::jsonb),');
  execute replace(pg_get_functiondef(ra),
    'where s.student_id = _student_id and s.status = ''passed'' and exists (select 1 from public.voice_explanations dv where dv.task_id = s.task_id and dv.student_id = _student_id and dv.status = ''scored'' and dv.withdrawn_at is null); -- 351: done Lots only',
    'where s.student_id = _student_id and s.status = ''passed'' and lower(k.status) = ''completed'';');
end $$;
notify pgrst, 'reload schema';
