-- ============================================================================
-- Stage 1 fix — let a new account claim its own member type.
--
-- The first migration allowed only admins to insert into user_roles. Signup
-- writes the member type from the browser (src/pages/AuthCallback.tsx:202), so
-- that policy blocked every new account from getting a role at all — and
-- without a role, ensureStudentProfile returns early and no profile row is
-- created either. Email signup and Google sign-in were both dead.
--
-- A signed-in account may now claim its own row. What it may NOT claim is
-- 'admin'; that is the privilege-escalation hole and it stays closed. The
-- unique constraint on user_id means the claim can only happen once, so nobody
-- can quietly upgrade themselves later.
-- ============================================================================

create policy user_roles_self_claim on public.user_roles
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role in ('student', 'college_admin', 'startup')
  );
