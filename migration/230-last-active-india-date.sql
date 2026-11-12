-- 230 (overnight TEST 12 Nov 2026, item 4): "Last active -1d ago" between 00:00 and 05:30 IST.
--   These functions subtract an India date (last try at time zone Asia/Kolkata) from current_date, which is the
--   database's UTC date - so just after midnight IST the result was -1. Same fix as 171: run them in India time.
-- Rollback: migration/230-rollback-last-active-india-date.sql
begin;
alter function public.tpo_student_profile(uuid) set timezone to 'Asia/Kolkata';
alter function public.tpo_students(text, text, text, text, text, text, integer, integer) set timezone to 'Asia/Kolkata';
alter function public.tpo_attention() set timezone to 'Asia/Kolkata';
alter function public.recruiter_proof_profile(uuid) set timezone to 'Asia/Kolkata';
do $$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('tpo_student_profile', 'tpo_students', 'tpo_attention', 'recruiter_proof_profile')
              and not coalesce(proconfig, '{}') @> array['TimeZone=Asia/Kolkata']) then
    raise exception '230 self-check: a last-active function still uses the UTC date';
  end if;
end $$;
commit;
