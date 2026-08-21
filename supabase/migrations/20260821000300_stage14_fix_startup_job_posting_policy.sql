-- No startup could post a job: "permission denied for function has_role".
--
-- Adding the missing source column fixed only half of what was blocking this.
-- The insert policy also called public.has_role(), which the authenticated role
-- has no EXECUTE on, and a policy that cannot be evaluated fails the whole
-- statement. Caught by posting a job as a real startup account instead of as
-- postgres — as postgres it had worked fine, which is exactly why it was missed.
--
-- Granting EXECUTE on has_role would work and is the wrong fix: it would let
-- any signed-in user ask the database what role anybody else holds, which is
-- how you enumerate the administrators. The policy only ever needed the
-- caller's OWN role, and user_roles_own_select already lets them read exactly
-- that one row — so the check is inlined and needs no new privilege at all.
drop policy job_opportunities_post on public.job_opportunities;

create policy job_opportunities_post on public.job_opportunities
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.user_roles r
       where r.user_id = (select auth.uid())
         and r.role = 'startup'::app_role
    )
  );
