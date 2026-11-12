-- 317 ROLLBACK: no assigned_by(tasks); my_shortlists without responded_at (the definition before 317).
begin;
drop function if exists public.assigned_by(public.tasks);
drop function if exists public.my_shortlists();
create function public.my_shortlists()
 returns table(id uuid, company text, note text, stage text, student_response text, created_at timestamptz)
 language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select sl.id, r.company, sl.note, sl.stage, sl.student_response, sl.created_at
    from public.recruiter_shortlists sl
    join public.recruiters r on r.id = sl.recruiter_id
   where sl.student_id = (select auth.uid())
   order by sl.created_at desc;
$function$;
revoke all on function public.my_shortlists() from public, anon;
grant execute on function public.my_shortlists() to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
