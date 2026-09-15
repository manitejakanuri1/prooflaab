-- Self sign-up writes the account row, so its role and college can be saved.
--
-- A person who signs up themselves (college, recruiter, startup, student) gets a
-- login at Identity Platform, and the auth-bridge maps it to a uuid through
-- resolve_account. Nothing wrote auth.users for them: only record_account does,
-- and only the college import calls that. user_roles, colleges and the rest all
-- reference auth.users, so the sign-up form's inserts failed on the foreign key.
-- The form logs and carries on, so the person saw a normal sign-up while the
-- admin dashboard never heard of them. Found on 15 Sep 2026: three sign-ups, zero
-- roles, zero college rows.
--
-- resolve_account runs for every token the bridge mints, so this is the one
-- place every account passes through. It now makes sure the row exists, and
-- records Google's email confirmation there once it happens.

begin;

create or replace function public.resolve_account(
  _provider_uid text,
  _email text default null,
  _provider_verified boolean default false
)
returns table (user_id uuid, email_confirmed boolean)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  _uuid uuid;
begin
  _uuid := public.resolve_account_uuid(_provider_uid, _email);

  if nullif(trim(coalesce(_email, '')), '') is not null then
    insert into auth.users (id, email, email_confirmed_at, created_at)
    values (_uuid, lower(trim(_email)),
            case when _provider_verified then now() else null end, now())
    on conflict (id) do update
      -- Record a confirmation when Google reports one; never remove one the
      -- database already holds (a college vouching for its student).
      set email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at);
  end if;

  return query
  select _uuid,
         coalesce(
           _provider_verified
             or exists (select 1 from auth.users u
                         where u.id = _uuid and u.email_confirmed_at is not null),
           false
         );
end;
$$;

revoke all on function public.resolve_account(text, text, boolean) from public, anon, authenticated;
grant execute on function public.resolve_account(text, text, boolean) to service_role;

do $$
declare r record;
begin
  select * into r from public.resolve_account('selftest-signup-0001', 'selftest-signup@prooflab.test', false);
  if not exists (select 1 from auth.users where id = r.user_id and email_confirmed_at is null) then
    raise exception 'a new sign-up did not get an unconfirmed account row';
  end if;
  select * into r from public.resolve_account('selftest-signup-0001', 'selftest-signup@prooflab.test', true);
  if not r.email_confirmed or not exists (select 1 from auth.users where id = r.user_id and email_confirmed_at is not null) then
    raise exception 'Google confirmation was not recorded';
  end if;
  select * into r from public.resolve_account('selftest-signup-0001', 'selftest-signup@prooflab.test', false);
  if not r.email_confirmed then
    raise exception 'a recorded confirmation was lost';
  end if;
  if has_function_privilege('authenticated', 'public.resolve_account(text,text,boolean)', 'EXECUTE') then
    raise exception 'resolve_account is reachable from a browser';
  end if;
  delete from auth.users where email = 'selftest-signup@prooflab.test';
  delete from public.account_identities where provider_uid = 'selftest-signup-0001';
end $$;

commit;
