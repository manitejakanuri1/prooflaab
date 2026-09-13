-- One place that records an account, and whether its address was vouched for.
--
-- Two gaps found by logging in through a real browser, both invisible to a
-- script:
--
--   1. The app blocked the login with "please confirm your email address".
--      Identity Platform marks a new account unverified, and refuses to let
--      anything but an administrator credential change that - it accepts the
--      call and silently ignores it, which was verified rather than assumed.
--      On Supabase a college creating students passed email_confirm: true and
--      those students could sign in immediately. Without an equivalent, no
--      college could ever enrol anybody.
--
--   2. Nothing wrote the auth.users row. Creating an account now happens in
--      Identity Platform, which knows nothing about this database, so the
--      account existed for signing in and did not exist for any foreign key.
--
-- The split this settles: Identity Platform owns the password. This database
-- owns the record of the account, including whether its address was vouched
-- for. A self-signup is still unverified until the person clicks the link -
-- that check is not weakened. A student enrolled by their college is confirmed
-- because the college vouched for them, exactly as before.

begin;

-- ---------------------------------------------------------------------------
-- 1. resolve, and say whether the address is settled
-- ---------------------------------------------------------------------------

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

  return query
  select _uuid,
         -- Confirmed if Google says so, or if this database already recorded a
         -- confirmation - which is how a college vouches for a student it
         -- enrolled. Either is enough; neither is invented here.
         coalesce(
           _provider_verified
             or exists (select 1 from auth.users u
                         where u.id = _uuid and u.email_confirmed_at is not null),
           false
         );
end;
$$;

revoke all on function public.resolve_account(text, text, boolean) from public;
revoke all on function public.resolve_account(text, text, boolean) from anon, authenticated;
grant execute on function public.resolve_account(text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 2. record an account the moment it is created
-- ---------------------------------------------------------------------------

/**
 * Write the auth.users row for an account that was just created in Identity
 * Platform, and return the uuid the rest of the database should use.
 *
 * _vouched is what Supabase's email_confirm: true meant: the caller - an admin
 * or a college running an import - is asserting the address is real. It is a
 * service_role-only function, so only server-side code can assert it; nothing a
 * browser holds can reach this.
 */
create or replace function public.record_account(
  _provider_uid text,
  _email text,
  _full_name text default null,
  _vouched boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  _uuid uuid;
begin
  if _email is null or length(trim(_email)) = 0 then
    raise exception 'record_account needs an email address';
  end if;

  _uuid := public.resolve_account_uuid(_provider_uid, _email);

  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at, created_at)
  values (
    _uuid,
    lower(trim(_email)),
    case when _full_name is null then '{}'::jsonb
         else jsonb_build_object('full_name', _full_name) end,
    case when _vouched then now() else null end,
    now()
  )
  on conflict (id) do update
    set email = excluded.email,
        -- Never un-confirm an address that was already settled: a second import
        -- of the same student must not lock them out.
        email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at);

  return _uuid;
end;
$$;

revoke all on function public.record_account(text, text, text, boolean) from public;
revoke all on function public.record_account(text, text, text, boolean) from anon, authenticated;
grant execute on function public.record_account(text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 3. prove it
-- ---------------------------------------------------------------------------

do $$
declare
  uid1 uuid;
  uid2 uuid;
  confirmed boolean;
begin
  if has_function_privilege('anon', 'public.record_account(text,text,text,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_account(text,text,text,boolean)', 'EXECUTE') then
    raise exception 'record_account is reachable by a browser role; anyone could vouch for any address';
  end if;

  -- A college enrolling a student: vouched, so they can sign in at once.
  uid1 := public.record_account('selftest-idp-vouched', 'selftest.vouched@test.invalid', 'Vouched Student', true);
  select r.email_confirmed into confirmed
    from public.resolve_account('selftest-idp-vouched', null, false) r;
  if not confirmed then
    raise exception 'a vouched account was reported unconfirmed, so its college could never enrol it';
  end if;

  -- Somebody signing themselves up: not vouched, and Google has not verified
  -- them either, so they stay blocked until they click the link.
  uid2 := public.record_account('selftest-idp-selfsignup', 'selftest.self@test.invalid', 'Self Signup', false);
  select r.email_confirmed into confirmed
    from public.resolve_account('selftest-idp-selfsignup', null, false) r;
  if confirmed then
    raise exception 'an unverified self-signup was reported confirmed; the check has been weakened';
  end if;

  -- ...and Google verifying them later is enough on its own.
  select r.email_confirmed into confirmed
    from public.resolve_account('selftest-idp-selfsignup', null, true) r;
  if not confirmed then
    raise exception 'Google verified the address and it was still refused';
  end if;

  -- Recording the same account twice must not undo a confirmation.
  perform public.record_account('selftest-idp-vouched', 'selftest.vouched@test.invalid', 'Vouched Student', false);
  select r.email_confirmed into confirmed
    from public.resolve_account('selftest-idp-vouched', null, false) r;
  if not confirmed then
    raise exception 're-importing a student un-confirmed them and locked them out';
  end if;

  delete from auth.users where id in (uid1, uid2);
  delete from public.account_identities
   where provider_uid in ('selftest-idp-vouched', 'selftest-idp-selfsignup');

  raise notice 'vouched accounts sign in; self-signups stay blocked until verified; re-import is safe';
end $$;

commit;
