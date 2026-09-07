-- ============================================================================
-- Stage 53b — the cohort trigger function is not part of the API.
--
-- student_cohort_defaults() is a trigger function. Postgres does not check
-- EXECUTE on it when the trigger fires, so no browser role needs the grant,
-- but it was created without one being revoked and so inherited EXECUTE from
-- PUBLIC like every other new function in this database does. Stage 46 set the
-- rule for exactly this case: trigger and cron functions get no browser grant
-- at all.
-- ============================================================================

revoke all on function public.student_cohort_defaults() from public, anon, authenticated;
