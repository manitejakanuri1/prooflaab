-- ============================================================================
-- Stage 46 — close the doors a logged-out visitor could still push on.
--
-- get_advisors flagged 14 SECURITY DEFINER functions in public that `anon`
-- could execute. Verified by calling them with nothing but the publishable
-- key: tpo_scoring_rules and tpo_naming_themes returned real rows to a
-- logged-out caller. The write ones were never exploitable (they resolve the
-- caller's college through my_college_id(), which is null for anon, and raise)
-- but they should not have been reachable either.
--
-- Three of the fourteen (colleges_open_season, notify_squad_placement,
-- student_levels_refresh_unlock) are trigger functions and one
-- (notify_weekly_progress) is only ever called by a cron job. Triggers and
-- cron run as the table/job owner, not as the caller, so none of the four
-- needs an EXECUTE grant to any browser role at all.
--
-- EXECUTE is revoked from PUBLIC as well as from anon and authenticated by
-- name: this database also has default privileges granting EXECUTE to those
-- two roles, so revoking from anon alone is a silent no-op. Revoking PUBLIC
-- also strips service_role, whose EXECUTE came through PUBLIC, so every
-- function is granted back to service_role by name straight afterwards.
--
-- The three views the same audit flagged keep their SELECT grants and their
-- security_invoker=off setting on purpose:
--   - admin_users and llm_usage_by_student each carry their own
--     `where is_admin()` clause, and admin_users' INSTEAD OF trigger
--     (admin_users_write) raises unless is_admin(). Turning security_invoker
--     on would make them run as the caller, who has no SELECT on auth.users,
--     and the admin screens would break for the very people they are for.
--   - public_resume_scorecards is meant to be readable logged-out; it already
--     filters to student_portfolios.is_public = true. Running it as the caller
--     would apply resume_scorecards' RLS to anon and return nothing.
-- What they should not have is write access. None of the three has an
-- updatable definition, so the INSERT/UPDATE/DELETE grants on them could only
-- ever produce a confusing error; they are removed here.
-- ============================================================================

do $$
declare
  r record;
  callers_are_signed_in constant text[] := array[
    'my_placement_status', 'my_todays_lot', 'save_mock_interview_answer',
    'tpo_naming_themes', 'tpo_placement_report', 'tpo_reset_naming_theme',
    'tpo_reset_scoring_weight', 'tpo_scoring_rules', 'tpo_set_naming_theme',
    'tpo_set_scoring_weight'
  ];
begin
  for r in
    select p.oid::regprocedure::text as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosecdef
       and p.proname in (
         'colleges_open_season', 'my_placement_status', 'my_todays_lot',
         'notify_squad_placement', 'notify_weekly_progress',
         'save_mock_interview_answer', 'student_levels_refresh_unlock',
         'tpo_naming_themes', 'tpo_placement_report', 'tpo_reset_naming_theme',
         'tpo_reset_scoring_weight', 'tpo_scoring_rules',
         'tpo_set_naming_theme', 'tpo_set_scoring_weight'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);

    if r.proname = any (callers_are_signed_in) then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

revoke insert, update, delete on public.llm_usage_by_student from anon, authenticated;
revoke insert, update, delete on public.public_resume_scorecards from anon, authenticated;
