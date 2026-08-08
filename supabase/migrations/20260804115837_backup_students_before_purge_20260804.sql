-- Snapshot before purging all students, so this is recoverable.
CREATE TABLE IF NOT EXISTS public.student_profiles_backup_20260804 AS
  SELECT * FROM public.student_profiles;

CREATE TABLE IF NOT EXISTS public.resume_scorecards_backup_20260804 AS
  SELECT * FROM public.resume_scorecards;

CREATE TABLE IF NOT EXISTS public.resume_claims_backup_20260804 AS
  SELECT * FROM public.resume_claims;

CREATE TABLE IF NOT EXISTS public.auth_users_backup_20260804 AS
  SELECT id, email, created_at, raw_user_meta_data
  FROM auth.users;

-- Backups hold personal data: keep them off the API entirely.
ALTER TABLE public.student_profiles_backup_20260804 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_scorecards_backup_20260804 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resume_claims_backup_20260804 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_users_backup_20260804 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.student_profiles_backup_20260804 FROM anon, authenticated;
REVOKE ALL ON public.resume_scorecards_backup_20260804 FROM anon, authenticated;
REVOKE ALL ON public.resume_claims_backup_20260804 FROM anon, authenticated;
REVOKE ALL ON public.auth_users_backup_20260804 FROM anon, authenticated;;
