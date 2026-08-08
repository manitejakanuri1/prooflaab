-- 1. llm_usage_by_student joins every student's email and full name to their AI
-- spend. Without security_invoker the view ran as its owner, so row-level
-- security on llm_usage and student_profiles was skipped entirely: anyone able
-- to select from the view read every student's email and usage.
--
-- security_invoker makes the view obey the policies of whoever queries it. The
-- admin dashboard still sees everything (its policies allow that); a student
-- sees only their own row.
ALTER VIEW public.llm_usage_by_student SET (security_invoker = on);

REVOKE ALL ON public.llm_usage_by_student FROM anon;

-- 2. create_user_with_role assigned a role to whatever user id it was handed,
-- with no check that the caller was that user. Execution is already revoked
-- above -- nothing in the app calls it -- but the missing guard is the actual
-- bug, and a future GRANT should not reopen it.
CREATE OR REPLACE FUNCTION public.create_user_with_role(
  _user_id     uuid,
  _role        app_role,
  _invite_code text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- You may only assign a role to yourself. Without this, any caller could
  -- hand any account any role.
  IF auth.uid() IS NULL OR _user_id <> auth.uid() THEN
    RETURN false;
  END IF;

  IF _role IN ('startup', 'college_admin', 'admin') THEN
    IF _invite_code IS NULL OR NOT public.validate_invite_code(_invite_code, _role) THEN
      RETURN false;
    END IF;
    PERFORM public.use_invite_code(_invite_code, _user_id);
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.create_user_with_role(uuid, app_role, text) FROM anon, authenticated;
