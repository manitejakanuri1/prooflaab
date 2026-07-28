-- Students could never mark their own onboarding wizard as complete: user_roles
-- only allowed admins to UPDATE, and self-service update of has_completed_wizard
-- was missing entirely. That silently failed, and RoleBasedProtectedRoute bounced
-- every student back to /onboarding-wizard right after they finished it.
--
-- Fix via a narrow SECURITY DEFINER function instead of a broad RLS UPDATE policy,
-- so a student can flip this one flag on their own row without being able to touch
-- their own `role` column (which a permissive own-row UPDATE policy would allow).

CREATE OR REPLACE FUNCTION public.complete_own_wizard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_roles SET has_completed_wizard = true WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_own_wizard() TO authenticated;
