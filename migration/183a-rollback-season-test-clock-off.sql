-- Rollback of 183a: removes the always-false helper. Only where nothing reads it (before 184), and never on TEST,
-- where the helper is the real fast-clock one.
begin;
drop function if exists public.test_fast_season(uuid);
commit;
