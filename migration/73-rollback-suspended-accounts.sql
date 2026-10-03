-- Rollback of 73. FIRST remove the setting PGRST_DB_PRE_REQUEST from the API service (otherwise every
-- request fails looking for the function), then:
drop function if exists public.refuse_suspended();
drop function if exists public.account_is_suspended(uuid);
notify pgrst, 'reload schema';
