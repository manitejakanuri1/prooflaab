-- Rollback of 55. Deploy the previous accounts image first. Students the sync
-- suspended stay suspended; restore them deliberately if needed:
--   update public.student_profiles set status = 'active' where status = 'suspended';
begin;
drop trigger if exists guard_protected_account_delete on auth.users;
drop function if exists public.guard_protected_account_delete();
drop function if exists public.sync_suspend_students(uuid[]);
drop function if exists public.sync_restore_students(uuid[]);
drop table if exists public.protected_test_accounts;
alter table public.account_sync_missing drop column if exists suspended_at;
do $$ begin raise notice '55 rolled back'; end $$;
commit;
notify pgrst, 'reload schema';
