-- Rollback for 275.
begin;
do $$ begin
  execute replace(replace(replace(pg_get_functiondef('public.tpo_students(text,text,text,text,text,text,integer,integer)'::regprocedure),
    'select a.student_id, a.severity, a.reason_codes from public.tpo_attention() a',
    'select a.student_id, a.severity from public.tpo_attention() a'),
    'coalesce(att.severity, ''ok'') as attn, coalesce(att.reason_codes, ''{}''::text[]) as codes,',
    'coalesce(att.severity, ''ok'') as attn,'),
    'or (_status = ''active_week''  and b.quiet <= 7) or (_status = ''missed_lots'' and ''missed_lots'' = any(b.codes)))',
    'or (_status = ''active_week''  and b.quiet <= 7))');
  execute replace(pg_get_functiondef('public.tpo_student_profile(uuid)'::regprocedure),
    'select distinct on (s.task_id) s.id, null::text as file_name, case when exists (select 1 from public.task_submissions y where y.student_id = p.id and y.task_id = s.task_id and y.status = ''passed'') then ''passed'' else s.status end as status, (select t2.status from public.tasks t2 where t2.id = s.task_id) as task_status,',
    'select distinct on (s.task_id) s.id, null::text as file_name, s.status,');
end $$;
notify pgrst, 'reload schema';
commit;
