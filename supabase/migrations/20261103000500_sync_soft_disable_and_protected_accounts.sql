-- 55: account sync suspends instead of deleting (F6), and protected test accounts.
--
-- The accounts /sync job no longer calls remove_students (a hard delete that
-- cascades every row a student owns). It may only SUSPEND a student whose login
-- stayed missing (accounts/sync_plan.py) and RESTORE them when the login returns.
-- Permanent removal stays a deliberate admin/college action (accounts /remove).
--
-- protected_test_accounts: test fixtures (staging, and later the production smoke
-- accounts) that no automation may suspend, and that cannot be deleted at all unless
-- the deleting transaction explicitly sets prooflab.allow_protected_delete = on.
--
-- Rollback: migration/55-rollback-sync-soft-disable.sql
begin;

alter table public.account_sync_missing add column if not exists suspended_at timestamptz;

create table if not exists public.protected_test_accounts (
  user_id    uuid primary key,
  label      text not null,
  created_at timestamptz not null default now()
);
alter table public.protected_test_accounts enable row level security;
revoke all on public.protected_test_accounts from public, anon, authenticated;
grant all on public.protected_test_accounts to service_role;

create or replace function public.sync_suspend_students(_ids uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  with s as (
    update public.student_profiles p set status = 'suspended', updated_at = now()
     where p.id = any(_ids) and p.status = 'active'
       and not exists (select 1 from public.protected_test_accounts t where t.user_id = p.user_id)
    returning p.id)
  update public.account_sync_missing m set suspended_at = now()
    from s where m.student_id = s.id;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.sync_restore_students(_ids uuid[])
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  -- Only students THIS job suspended (a suspension recorded in the ledger) come back.
  update public.student_profiles p set status = 'active', updated_at = now()
    from public.account_sync_missing m
   where m.student_id = p.id and p.id = any(_ids) and p.status = 'suspended' and m.suspended_at is not null;
  get diagnostics n = row_count;
  delete from public.account_sync_missing where student_id = any(_ids);
  return n;
end $$;

revoke all on function public.sync_suspend_students(uuid[]) from public, anon, authenticated;
revoke all on function public.sync_restore_students(uuid[]) from public, anon, authenticated;
grant execute on function public.sync_suspend_students(uuid[]) to service_role;
grant execute on function public.sync_restore_students(uuid[]) to service_role;

create or replace function public.guard_protected_account_delete()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.protected_test_accounts t where t.user_id = old.id)
     and coalesce(current_setting('prooflab.allow_protected_delete', true), '') <> 'on' then
    raise exception 'account % is a protected test fixture and cannot be deleted', old.id
      using errcode = 'check_violation';
  end if;
  return old;
end $$;
revoke all on function public.guard_protected_account_delete() from public, anon, authenticated;
drop trigger if exists guard_protected_account_delete on auth.users;
create trigger guard_protected_account_delete before delete on auth.users
  for each row execute function public.guard_protected_account_delete();

do $$
declare probe uuid := gen_random_uuid(); blocked boolean := false;
begin
  if has_function_privilege('authenticated', 'public.sync_suspend_students(uuid[])', 'EXECUTE') then
    raise exception 'a browser could suspend students';
  end if;
  insert into auth.users (id, email, created_at) values (probe, 'protected-probe@test.invalid', now());
  insert into public.protected_test_accounts (user_id, label) values (probe, 'migration 55 self-check');
  begin
    delete from auth.users where id = probe;
  exception when check_violation then blocked := true;
  end;
  if not blocked then raise exception 'a protected account could be deleted'; end if;
  perform set_config('prooflab.allow_protected_delete', 'on', true);
  delete from auth.users where id = probe;
  delete from public.protected_test_accounts where user_id = probe;
  perform set_config('prooflab.allow_protected_delete', '', true);
  raise notice '55: sync suspends instead of deleting; protected accounts guarded';
end $$;

commit;
notify pgrst, 'reload schema';
