-- UNSAFE EMERGENCY ROLLBACK of 83.
-- This RESTORES OPEN DEFAULTS: every new table, sequence and function will again be fully
-- available to anon/authenticated (and functions to PUBLIC) unless a migration remembers to lock it.
-- Existing objects are not affected either way. Use only if 83 blocked a legitimate deployment, then
-- re-apply 83 and add the missing explicit grant instead.
begin;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public grant usage, select, update on sequences to anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;
alter default privileges for role postgres grant execute on functions to public;
commit;
