-- Migration 221 (TEST, sweep 11 Nov 2026, M9): needs_review_submissions adds max_points to each rubric part.
-- Rollback: migration/221-rollback-flagged-parts-of-10.sql.
begin;
CREATE OR REPLACE FUNCTION public.needs_review_submissions()
 RETURNS TABLE(submission_id uuid, task_id uuid, task_title text, student_id uuid, student_name text, score integer, flags text[], rubric_scores jsonb, code text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select s.id, s.task_id, t.title, s.student_id, p.full_name,
         s.sandbox_score, s.flags,
         -- Migration 221 (sweep M9): each part carries its top points, so screens show it as x/10.
         coalesce((select jsonb_agg(e || jsonb_build_object('max_points',
                     (select (c->>'max_points')::numeric from jsonb_array_elements(rc.criteria) c
                       where c->>'id' = e->>'criterion_id' limit 1)))
                     from jsonb_array_elements(case when jsonb_typeof(s.rubric_scores) = 'array'
                                                    then s.rubric_scores else '[]'::jsonb end) e),
                  s.rubric_scores),
         s.code, s.created_at
    from public.task_submissions s
    join public.tasks t on t.id = s.task_id
    left join public.task_rubric_config rc on rc.id = t.rubric_config_id
    join public.student_profiles p on p.id = s.student_id
   where s.status = 'needs_review'
     and (
       coalesce(public.is_admin(), false)
       or exists (
            select 1 from public.colleges c
             where c.id = p.college_id
               and c.user_id = (select auth.uid())
               and c.verification_status = 'approved')
     )
   order by s.created_at asc;
$function$
;
do $$ begin
  if position('max_points' in pg_get_functiondef('public.needs_review_submissions'::regproc)) = 0 then
    raise exception '221 self-check failed'; end if;
end $$;
commit;
notify pgrst, 'reload schema';
