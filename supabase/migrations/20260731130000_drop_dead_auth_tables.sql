-- Dead code from the removed custom-OTP auth flow (replaced by Supabase Auth +
-- Resend SMTP, see 2026-07-17). Confirmed unreferenced by any src/ code, edge
-- function, cron job, or FK from a live table before dropping.
DROP FUNCTION IF EXISTS public.check_rate_limit(text, integer, integer);
DROP FUNCTION IF EXISTS public.cleanup_expired_otps();

DROP TABLE IF EXISTS public.students_auth;
DROP TABLE IF EXISTS public.student_otps;
DROP TABLE IF EXISTS public.email_verifications;
DROP TABLE IF EXISTS public.invite_codes_validation;
DROP TABLE IF EXISTS public.signup_rate_limits;
DROP TABLE IF EXISTS public.auth_rate_limits;
