-- ============================================================
--  Admin role management — run in Supabase SQL Editor only
--  (runs as a privileged role; NOT exposed to the app on purpose)
-- ============================================================
-- Access model: a user is admin iff public.user_roles.role = 'admin'
-- for their auth.uid(). That single row gates every /admin/* route.
-- The admin_users table (super/moderator) is only a directory/badge.

-- ── 1. PROMOTE a user to admin (by email) ───────────────────
UPDATE public.user_roles ur
SET role = 'admin', has_completed_wizard = true
FROM auth.users u
WHERE u.id = ur.user_id
  AND u.email = 'someone@example.com';   -- <-- change email

-- Also list them as a Super Admin in the admin directory (optional):
INSERT INTO public.admin_users (name, email, role, status)
SELECT COALESCE(sp.full_name, split_part(u.email,'@',1)), u.email, 'super', 'active'
FROM auth.users u
LEFT JOIN public.student_profiles sp ON sp.user_id = u.id
WHERE u.email = 'someone@example.com'    -- <-- change email
ON CONFLICT (email) DO UPDATE SET role = 'super', status = 'active';


-- ── 2. DEMOTE a user back to student (by email) ─────────────
UPDATE public.user_roles ur
SET role = 'student'
FROM auth.users u
WHERE u.id = ur.user_id
  AND u.email = 'someone@example.com';   -- <-- change email

DELETE FROM public.admin_users
WHERE email = 'someone@example.com';     -- <-- change email


-- ── 3. Make someone a MODERATOR instead of super ────────────
UPDATE public.admin_users SET role = 'moderator'
WHERE email = 'someone@example.com';     -- <-- change email


-- ── 4. LIST all admins / everyone's role ────────────────────
SELECT u.email, ur.role, ur.has_completed_wizard,
       au.role AS admin_tier, au.status
FROM auth.users u
LEFT JOIN public.user_roles ur ON ur.user_id = u.id
LEFT JOIN public.admin_users au ON au.email = u.email
ORDER BY (ur.role = 'admin') DESC, u.email;


-- Note: user_roles uses one row per user (.single() in the app),
-- so promoting removes the student role. To keep testing student
-- flows, use a separate account.
