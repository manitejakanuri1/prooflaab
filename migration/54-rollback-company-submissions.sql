-- Rollback of 54: drops the new company views and review table, restores recruiter_lots()
-- exactly as in 20260903000300_stage35d_shortlist_sponsored_home.sql. Deploy the previous website first.
begin;
drop function if exists public.company_review_submission(uuid, text, text);
drop function if exists public.company_submissions();
drop function if exists public.my_company_ok();
drop table if exists public.submission_reviews;
drop function if exists public.recruiter_lots();
create or replace function public.recruiter_lots()
returns table (task_id uuid, title text, student_id uuid, student_name text,
               created_at timestamptz, due_date timestamptz, task_status text,
               proof_id uuid, submitted_at timestamptz, proof_status text,
               ai_score integer, outcome text)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select t.id, t.title, t.student_id, p.full_name,
         t.created_at, t.due_date, t.status,
         pu.id, pu.submitted_at, pu.status, pu.ai_score,
         sl.stage
    from public.tasks t
    join public.student_profiles p on p.id = t.student_id
    left join lateral (
      select * from public.proof_uploads x
       where x.task_id = t.id order by x.submitted_at desc limit 1
    ) pu on true
    left join public.recruiter_shortlists sl
      on sl.recruiter_id = t.sponsored_by and sl.student_id = t.student_id
   where t.sponsored_by = public.my_recruiter_id()
   order by t.created_at desc;
$fn$;
revoke all on function public.recruiter_lots()                                from public, anon;
grant execute on function public.recruiter_lots()                             to authenticated;
do $$ begin raise notice '54 rolled back'; end $$;
commit;
notify pgrst, 'reload schema';
