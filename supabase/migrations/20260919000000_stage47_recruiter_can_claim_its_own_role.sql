-- ============================================================================
-- Stage 47 — a recruiter could not sign up at all.
--
-- The sign-up form writes the chosen role straight into user_roles from the
-- browser (EnhancedRoleBasedAuthForm.tsx). user_roles_self_claim is the policy
-- that decides which roles a person is allowed to give themselves, and it
-- listed only student, college_admin and startup. 'recruiter' was added to
-- app_role in stage 35 but never added here, so every recruiter sign-up failed
-- RLS on that insert, ended up with no role at all, and was then turned away
-- by RoleBasedProtectedRoute on /recruiter/dashboard.
--
-- Nobody had noticed because the only two rows in `recruiters` are seeded
-- fixtures with made-up ids (ffffffff-0000-...), not real accounts.
--
-- Letting a recruiter claim the role is safe: the role on its own shows them
-- nothing. Every recruiter function goes through is_verified_recruiter(), and
-- `recruiters.verified` starts false until an administrator turns it on from
-- the new Admin -> Recruiters screen. 'admin' stays off this list, as before.
-- ============================================================================

drop policy user_roles_self_claim on public.user_roles;

create policy user_roles_self_claim on public.user_roles
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = any (array[
      'student'::app_role,
      'college_admin'::app_role,
      'startup'::app_role,
      'recruiter'::app_role
    ])
  );
