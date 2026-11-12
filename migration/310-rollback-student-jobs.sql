-- Rollback for 310: old read policy back (any signed-in user reads approved rows), student/college job functions
-- and the Apply click table removed (its click rows go with it).
begin;
drop function if exists public.college_job_posts();
drop function if exists public.student_job_apply_click(uuid);
drop function if exists public.student_jobs();
drop table if exists public.job_apply_clicks;
drop policy if exists job_opportunities_read on public.job_opportunities;
create policy job_opportunities_read on public.job_opportunities for select to authenticated
  using (status = 'approved' or created_by = (select auth.uid()) or (select public.is_admin()));
commit;
notify pgrst, 'reload schema';
