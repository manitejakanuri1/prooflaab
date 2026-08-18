-- ============================================================================
-- Stage 1 fix — restore the table grants that dropping the schema destroyed.
--
-- Found by running the student journey end to end as a real signed-in user
-- rather than as postgres. The very first read failed with:
--
--   permission denied for table student_contact
--
-- Dropping schema public also dropped the default privileges attached to it.
-- Every other schema still has its entry in pg_default_acl; public's was gone,
-- so the nine new tables were created with no grants to anon, authenticated or
-- service_role at all.
--
-- This is the dangerous kind of failure: the policies were correct and the
-- advisors were clean, because Postgres checks grants BEFORE row level
-- security. RLS never even ran. Every page in the app would have failed on
-- every query, and nothing in the schema itself looked wrong.
--
-- Testing as postgres hides this completely — postgres bypasses both grants and
-- RLS. Any future check has to impersonate `authenticated`.
-- ============================================================================

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Puts back what Supabase configures on a fresh project, so tables created from
-- here on get their grants automatically instead of silently having none.
--
-- Row level security remains the real gate: a grant only makes a table
-- reachable, and every table here has RLS enabled with policies scoping rows to
-- their owner. A future table that forgets to enable RLS is reported as an
-- ERROR by the security advisor.
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
