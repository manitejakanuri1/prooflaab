-- Rollback for migration 221.
begin;
CREATE OR REPLACE FUNCTION public.needs_review_submissions()
 RETURNS TABLE(submission_id uuid, task_id uuid, task_title text, student_id uuid, student_name text, score integer, flags text[], rubric_scores jsonb, code text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select s.id, s.task_id, t.title, s.student_id, p.full_name,
         s.sandbox_score, s.flags, s.rubric_scores, s.code, s.created_at
    from public.task_submissions s
    join public.tasks t on t.id = s.task_id
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
commit;
notify pgrst, 'reload schema';
