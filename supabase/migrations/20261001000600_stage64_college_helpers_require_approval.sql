-- ============================================================================
-- Stage 64 — the other two college helpers also require approval.
--
-- Stage 63 gated twelve policies on my_approved_college_ids(). The Supabase
-- security advisor then pointed at the rest of the surface: my_college_id() is
-- SECURITY DEFINER, callable by any signed-in account, and says only
--
--   select id from public.colleges where user_id = (select auth.uid()) limit 1;
--
-- with no approval check at all. Twenty-nine functions call it - the whole
-- tpo_* dashboard - and fifteen more RLS policies use it. Scoping is not the
-- problem there: it returns the caller's OWN college and nothing else, so no
-- cross-college read was ever possible through it. What it does do is let a
-- college that has not been approved keep operating its dashboard, which is
-- exactly what stage 63 set out to stop.
--
-- Fixing the helper fixes all forty-four call sites at once, which is why this
-- is two functions and not forty-four rewrites.
--
-- viewer_college_id() gets the same treatment on its first branch. An
-- unapproved college owner now falls through to the student branch, which finds
-- nothing for them, so they see nothing - the intended outcome.
-- ============================================================================

create or replace function public.my_college_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select id
    from public.colleges
   where user_id = (select auth.uid())
     and verification_status = 'approved'
   limit 1;
$fn$;

create or replace function public.viewer_college_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(
    (select c.id
       from public.colleges c
      where c.user_id = (select auth.uid())
        and c.verification_status = 'approved'
      limit 1),
    (select p.college_id
       from public.student_profiles p
      where p.id = (select auth.uid())
      limit 1));
$fn$;
