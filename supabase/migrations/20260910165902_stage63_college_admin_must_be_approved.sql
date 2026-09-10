-- NOTE ON THE FILE NAME: this is version 20260910165902 because that is what
-- apply_migration recorded in the live database, and the folder has to match
-- what actually ran. The other laptop independently used "stage 63" for
-- 20261001000500_stage63_demo_students_discoverable.sql on the same day, so the
-- stage numbers collide. Both are applied; neither depends on the other.
--
-- ============================================================================
-- Stage 63 — a college_admin must be an APPROVED college.
--
-- user_roles_self_claim lets an account give itself 'college_admin' at signup,
-- with no invite code and no approval:
--
--   with check (user_id = (select auth.uid())
--               and role = any (array['student','college_admin','startup','recruiter']))
--
-- That was deliberate and it has to stay - the sign-up form writes the role
-- straight from the browser, so removing it from the list would break college
-- sign-up exactly the way stage 47 found recruiter sign-up broken. The recruiter
-- case was solved the right way: claim the role freely, but let the role alone
-- show you nothing until an administrator flips `recruiters.verified`.
--
-- colleges already carries the same idea in verification_status
-- ('pending' | 'approved' | 'rejected', default 'pending') and the admin screens
-- already read and filter it - AdminDashboardOverview counts 'approved' as the
-- active colleges. Nothing ever enforced it. Twelve policies scoped their reads
-- to "a college I own" and never asked whether that college was approved, so
-- self-claiming the role and inserting a colleges row was enough to stand up a
-- working college dashboard.
--
-- One function decides now, and the twelve policies ask it.
-- ============================================================================

create or replace function public.my_approved_college_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select id
    from public.colleges
   where user_id = (select auth.uid())
     and verification_status = 'approved'
$fn$;

revoke all on function public.my_approved_college_ids() from public, anon;
grant execute on function public.my_approved_college_ids() to authenticated;

-- ── normalise the column before anything depends on it ──────────────────────
-- colleges.verification_status was never constrained. startups.verification_status
-- was, to ('pending','approved','rejected'), and the admin dashboard counts
-- 'approved' for BOTH - AdminDashboardOverview.tsx:37. The one college row in
-- the database says 'verified', a value nothing else in the codebase uses, so
-- that dashboard has been reporting zero active colleges while one exists.
-- Gating the policies on 'approved' without this would have locked that college
-- out instead.
update public.colleges
   set verification_status = 'approved'
 where verification_status = 'verified';

-- Anything still outside the vocabulary becomes 'pending' rather than blocking
-- the constraint below. Nothing matches today; this is here so the migration
-- cannot fail against a database that has drifted further.
update public.colleges
   set verification_status = 'pending'
 where verification_status not in ('pending', 'approved', 'rejected');

alter table public.colleges
  drop constraint if exists colleges_verification_status_check;
alter table public.colleges
  add constraint colleges_verification_status_check
  check (verification_status in ('pending', 'approved', 'rejected'));

-- ── backfill ────────────────────────────────────────────────────────────────
-- A college that already has students is one somebody actually onboarded; an
-- account that self-claimed the role has none. That is the line: real colleges
-- keep working when enforcement switches on, squatters do not.
update public.colleges c
   set verification_status = 'approved'
 where c.verification_status = 'pending'
   and exists (select 1 from public.student_profiles sp where sp.college_id = c.id);

-- ── the twelve policies ─────────────────────────────────────────────────────
-- Identical rewrite in each: the inline "colleges where user_id = auth.uid()"
-- becomes my_approved_college_ids(). Nothing else about them changes.

-- stage 3 — verification settings
drop policy if exists verification_settings_read on public.verification_settings;
create policy verification_settings_read on public.verification_settings for select to authenticated
  using (public.is_admin() or college_id in (select public.my_approved_college_ids()));

drop policy if exists verification_settings_write on public.verification_settings;
create policy verification_settings_write on public.verification_settings for all to authenticated
  using (public.is_admin() or college_id in (select public.my_approved_college_ids()))
  with check (public.is_admin() or college_id in (select public.my_approved_college_ids()));

-- stage 10 — recruiter links
drop policy if exists recruiter_links_own on public.recruiter_links;
create policy recruiter_links_own on public.recruiter_links for all to authenticated
  using (public.is_admin() or college_id in (select public.my_approved_college_ids()))
  with check (public.is_admin() or college_id in (select public.my_approved_college_ids()));

drop policy if exists recruiter_link_views_read on public.recruiter_link_views;
create policy recruiter_link_views_read on public.recruiter_link_views for select to authenticated
  using (public.is_admin() or link_id in (
    select rl.id from public.recruiter_links rl
     where rl.college_id in (select public.my_approved_college_ids())));

-- stage 10 — the college dashboard's seven read policies
drop policy if exists student_profiles_college_read on public.student_profiles;
create policy student_profiles_college_read on public.student_profiles for select to authenticated
  using (college_id in (select public.my_approved_college_ids()));

drop policy if exists student_contact_college_read on public.student_contact;
create policy student_contact_college_read on public.student_contact for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
     where sp.college_id in (select public.my_approved_college_ids())));

drop policy if exists proof_uploads_college_read on public.proof_uploads;
create policy proof_uploads_college_read on public.proof_uploads for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
     where sp.college_id in (select public.my_approved_college_ids())));

drop policy if exists tasks_college_read on public.tasks;
create policy tasks_college_read on public.tasks for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
     where sp.college_id in (select public.my_approved_college_ids())));

drop policy if exists trust_scores_college_read on public.trust_scores;
create policy trust_scores_college_read on public.trust_scores for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
     where sp.college_id in (select public.my_approved_college_ids())));

drop policy if exists xp_logs_college_read on public.xp_logs;
create policy xp_logs_college_read on public.xp_logs for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
     where sp.college_id in (select public.my_approved_college_ids())));

drop policy if exists task_applications_college_read on public.task_applications;
create policy task_applications_college_read on public.task_applications for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
     where sp.college_id in (select public.my_approved_college_ids())));

drop policy if exists resume_scorecards_college_read on public.resume_scorecards;
create policy resume_scorecards_college_read on public.resume_scorecards for select to authenticated
  using (student_id in (
    select sp.id from public.student_profiles sp
     where sp.college_id in (select public.my_approved_college_ids())));
