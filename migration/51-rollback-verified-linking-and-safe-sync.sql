-- Rollback of 51. Deploy the previous accounts and functions images FIRST: the new
-- accounts /sync reads account_sync_missing and refuses to act without it.
begin;
drop table if exists public.account_sync_missing;
drop function if exists public.account_email_confirmed(uuid);
do $$ begin raise notice '51 rolled back'; end $$;
commit;
notify pgrst, 'reload schema';
