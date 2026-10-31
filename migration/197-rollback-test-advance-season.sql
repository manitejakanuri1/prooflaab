-- Rollback of 197 (also the planned removal after Grok's testing).
begin;
drop function if exists public.test_advance_season(uuid, integer);
commit;
