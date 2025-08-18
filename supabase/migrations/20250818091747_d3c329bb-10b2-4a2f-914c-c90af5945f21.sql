-- Generate invite codes for existing college_admin and startup roles that don't have them yet
INSERT INTO public.invite_codes (code, role, expires_at, is_used, used_by)
SELECT 
  upper(substring(md5(random()::text) from 1 for 6)) as code,
  ur.role,
  now() + interval '7 days' as expires_at,
  true as is_used,
  ur.user_id as used_by
FROM public.user_roles ur
WHERE ur.role IN ('college_admin', 'startup')
  AND NOT EXISTS (
    SELECT 1 FROM public.invite_codes ic 
    WHERE ic.used_by = ur.user_id 
    AND ic.role = ur.role
  );