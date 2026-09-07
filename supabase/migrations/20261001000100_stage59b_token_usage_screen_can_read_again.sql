-- ============================================================================
-- Stage 59b — Admin > Token Usage went blank.
--
-- The other laptop set security_invoker = true on llm_usage_by_student, which
-- is the right instinct: the view then runs as the person calling it rather
-- than as its owner, and the advisor's security_definer_view ERROR goes away.
--
-- The catch is that llm_usage underneath has RLS enabled and not one policy,
-- so "runs as the caller" means "returns nothing" - to everybody, including an
-- admin. The screen stopped showing real usage and started showing an empty
-- table, with no error to explain why.
--
-- Reverting security_invoker would fix the screen and reopen the lint. Adding
-- the missing policy fixes the screen and leaves the lint closed, so that is
-- what this does. Only an admin can read it. The edge functions that write
-- usage rows use service_role, which bypasses RLS and is unaffected.
--
-- Verified afterwards as a signed-in admin under the `authenticated` role:
-- llm_usage_by_student went from 0 rows back to 8.
--
-- SAME SHAPE OF PROBLEM, DELIBERATELY NOT TOUCHED HERE: public_resume_
-- scorecards also became security_invoker = true, so it now returns nothing to
-- anyone. Today that is invisible - there are zero resume scorecards and zero
-- public portfolios - and stage 48 had already decided that view should
-- require a login. It will need a policy on resume_scorecards before a student
-- ever makes a portfolio public, and that decision belongs with whoever owns
-- the portfolio feature.
-- ============================================================================

drop policy if exists llm_usage_admin_read on public.llm_usage;
create policy llm_usage_admin_read on public.llm_usage
  for select to authenticated
  using ((select public.is_admin()));
