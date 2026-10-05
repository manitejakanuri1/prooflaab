-- UNSAFE EMERGENCY SECURITY ROLLBACK of 87.
-- This gives anon and authenticated MAINTAIN on every public table again: any visitor or signed-in
-- user could then run ANALYZE / VACUUM / REINDEX / CLUSTER and take strong table locks (a
-- denial-of-service lever). Nothing in the app needs it. Use only if 87 provably broke something,
-- then re-apply 87 and grant the one missing right instead.
begin;
grant maintain on all tables in schema public to anon, authenticated;
commit;
