-- 51: server-side helpers for verified account linking (F4) and safe account sync (F6).
--
-- account_email_confirmed(_id): has this account's email been confirmed (by Google
--   sign-in, a verification link, or a college vouching for it at import)?
--   create-student-users refuses to link an existing UNCONFIRMED account to an
--   imported student: otherwise anyone could sign up with a student's address
--   before the college's CSV arrives and be linked as that student.
--
-- account_sync_missing: the ledger of logins seen missing by prooflab-accounts /sync.
--   A student is removed only after their login has been missing for a grace period
--   across separate passes, never from one listing (accounts/sync_plan.py).
--
-- Rollback: migration/51-rollback-verified-linking-and-safe-sync.sql
begin;

create or replace function public.account_email_confirmed(_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth, pg_temp
as $$
  select exists (select 1 from auth.users u where u.id = _id and u.email_confirmed_at is not null);
$$;
revoke all on function public.account_email_confirmed(uuid) from public, anon, authenticated;
grant execute on function public.account_email_confirmed(uuid) to service_role;

create table if not exists public.account_sync_missing (
  student_id        uuid primary key references public.student_profiles(id) on delete cascade,
  provider_uid      text not null,
  first_missing_at  timestamptz not null default now()
);
alter table public.account_sync_missing enable row level security;
revoke all on public.account_sync_missing from public, anon, authenticated;
grant all on public.account_sync_missing to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.account_email_confirmed(uuid)', 'EXECUTE') then
    raise exception 'a browser could probe account confirmation';
  end if;
  if has_table_privilege('authenticated', 'public.account_sync_missing', 'SELECT') then
    raise exception 'a browser could read the sync ledger';
  end if;
  if public.account_email_confirmed('00000000-0000-0000-0000-000000000000') then
    raise exception 'a non-existent account reported confirmed';
  end if;
  raise notice '51: verified-linking helper and sync ledger in place';
end $$;

commit;
notify pgrst, 'reload schema';
