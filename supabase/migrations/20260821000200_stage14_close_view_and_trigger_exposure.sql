-- Closing what the security advisor flagged after stage 14.
--
-- Supabase grants new objects in the public schema to anon and authenticated
-- through default privileges, so both new views picked up an anon grant the
-- moment they were created. Neither leaked anything — the is_admin() check
-- inside each view already returned zero rows to a signed-out caller — but a
-- grant that is never meant to be used should not be there to argue about.
revoke all on public.admin_users          from anon;
revoke all on public.llm_usage_by_student from anon;

-- Trigger functions are reachable as REST endpoints under /rest/v1/rpc. Called
-- outside a trigger they fail rather than do damage, but an endpoint whose only
-- behaviour is to error is still an endpoint.
--
-- Revoking EXECUTE does not stop the triggers: a trigger runs as the table
-- owner, not as whoever caused it. Verified afterwards by confirming
-- protect_columns still clamps a student setting their own XP.
revoke all on function public.admin_users_write()  from public, anon, authenticated;
revoke all on function public.on_level_cleared()   from public, anon, authenticated;
revoke all on function public.on_proof_change()    from public, anon, authenticated;
revoke all on function public.on_voice_recorded()  from public, anon, authenticated;
revoke all on function public.thread_post_count()  from public, anon, authenticated;
revoke all on function public.protect_columns()    from public, anon, authenticated;
revoke all on function public.touch_updated_at()   from public, anon, authenticated;
