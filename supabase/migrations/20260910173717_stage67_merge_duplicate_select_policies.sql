-- NOTE ON THE FILE NAME: version 20260910173717, as recorded by apply_migration.
--
-- Eight tables each had two or more permissive SELECT policies, and Postgres
-- runs every one of them on every read before OR-ing the results. Merging the
-- branches into a single policy is exactly equivalent - permissive policies are
-- already combined with OR - and halves the per-row work on the tables the
-- college dashboard reads most.
--
-- Every branch below is copied verbatim from the policy it replaces, including
-- the (select ...) wrappers, which are what let Postgres evaluate auth.uid(),
-- is_admin() and my_approved_college_ids() once per query as an InitPlan rather
-- than once per row. Dropping those wrappers would undo the point of this.
--
-- Verified by counting visible rows for a student, a college admin and an admin
-- before and after: all three unchanged on all eight tables.
--
-- Deliberately NOT merged: announcements, learning_resources, proof_uploads,
-- verification_settings, recruiters and user_roles. In each of those the second
-- policy is FOR ALL, so removing its SELECT overlap means splitting it into
-- separate INSERT/UPDATE/DELETE policies - a change to write access, for a read
-- speedup. Not worth the risk.

drop policy if exists student_profiles_own_select   on public.student_profiles;
drop policy if exists student_profiles_college_read on public.student_profiles;
create policy student_profiles_select on public.student_profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_admin())
    or college_id in (select public.my_approved_college_ids())
  );

drop policy if exists student_contact_own_select   on public.student_contact;
drop policy if exists student_contact_college_read on public.student_contact;
create policy student_contact_select on public.student_contact for select to authenticated
  using (
    student_id = (select auth.uid())
    or (select public.is_admin())
    or student_id in (
      select sp.id from public.student_profiles sp
       where sp.college_id in (select public.my_approved_college_ids()))
  );

drop policy if exists trust_scores_read         on public.trust_scores;
drop policy if exists trust_scores_college_read on public.trust_scores;
create policy trust_scores_select on public.trust_scores for select to authenticated
  using (
    student_id = (select auth.uid())
    or (select public.is_admin())
    or student_id in (
      select sp.id from public.student_profiles sp
       where sp.college_id in (select public.my_approved_college_ids()))
  );

drop policy if exists xp_logs_own_read     on public.xp_logs;
drop policy if exists xp_logs_college_read on public.xp_logs;
create policy xp_logs_select on public.xp_logs for select to authenticated
  using (
    student_id = (select auth.uid())
    or (select public.is_admin())
    or student_id in (
      select sp.id from public.student_profiles sp
       where sp.college_id in (select public.my_approved_college_ids()))
  );

drop policy if exists resume_scorecards_own_select   on public.resume_scorecards;
drop policy if exists resume_scorecards_college_read on public.resume_scorecards;
create policy resume_scorecards_select on public.resume_scorecards for select to authenticated
  using (
    student_id = (select auth.uid())
    or (select public.is_admin())
    or student_id in (
      select sp.id from public.student_profiles sp
       where sp.college_id in (select public.my_approved_college_ids()))
  );

drop policy if exists task_applications_read         on public.task_applications;
drop policy if exists task_applications_college_read on public.task_applications;
create policy task_applications_select on public.task_applications for select to authenticated
  using (
    student_id = (select auth.uid())
    or (select public.is_admin())
    or student_id in (
      select sp.id from public.student_profiles sp
       where sp.college_id in (select public.my_approved_college_ids()))
  );

drop policy if exists audit_logs_admin_read   on public.audit_logs;
drop policy if exists audit_logs_college_read on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (
    (select public.is_admin())
    or college_id = (select public.my_college_id())
  );

drop policy if exists tasks_read           on public.tasks;
drop policy if exists tasks_assigned_read  on public.tasks;
drop policy if exists tasks_college_read   on public.tasks;
drop policy if exists tasks_sponsored_read on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    student_id = (select auth.uid())
    or visibility = 'public'
    or (select public.is_admin())
    or (sponsored_by is not null and sponsored_by = (select auth.uid()))
    or exists (
      select 1 from public.task_assignments a
       where a.task_id = tasks.id and a.student_id = (select auth.uid()))
    or student_id in (
      select sp.id from public.student_profiles sp
       where sp.college_id in (select public.my_approved_college_ids()))
  );
