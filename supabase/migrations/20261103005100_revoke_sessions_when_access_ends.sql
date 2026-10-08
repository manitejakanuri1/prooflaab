-- 101: an account that stops being allowed loses its open browser session at once.
--
-- NOT APPLIED ANYWHERE. Review separately; staging first; owner's yes needed.
-- (99 is held by the parked college self-registration work; 100 is the policy clean-up.)
--
-- Needs 95 (web_sessions) and 96 (web_login_identity); both are recorded in the STAGING ledger
-- (confirmed 8 Oct 2026, with 97 and 98). Independent of 100: either order is safe.
-- The parked migration 99 would add a trigger named revoke_college_sessions on colleges; 99 is NOT
-- applied on staging, and the names here are different, so the two cannot collide.
-- Read-only preflight (columns, existing triggers): scripts/dev-tools/managed_accounts_preflight.sql
--
-- Sign-in is decided by web_login_identity (migration 96). Until now nothing looked at that
-- rule again after sign-in: an administrator could suspend a college or a company and the
-- person kept working in the tab they already had open until the session expired.
--
-- The web BFF reads the session's web_sessions row on every request and refuses a revoked
-- one. So the cheapest reliable way to end access is to revoke that row in the same
-- transaction that changes the account - no extra query per request, no waiting.
--
-- Whenever a row that web_login_identity reads is changed or removed, the same rule is asked
-- again for that login, and if the answer is no longer "allowed" its open session is revoked:
--
--   colleges          status, verification_status, user_id, name     (and delete)
--   startups          status, verification_status, user_id, name     (and delete)
--   student_profiles  status, onboarding_status, college_id, user_id, full_name   (and delete)
--   user_roles        role changed or row deleted -> always revoked (the session carries the old role)
--
-- One rule, asked in one place: if web_login_identity changes later, this follows it.
-- No account row is changed. Only web_sessions.revoked_at / last_seen_at are written.
-- The BFF also re-checks the rule itself (at most every 30 s per session) as a safety net.
begin;

create or replace function public.revoke_sessions_if_not_allowed(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if _user_id is null then
    return;
  end if;

  if coalesce((public.web_login_identity(_user_id) ->> 'allowed')::boolean, false) then
    return;
  end if;

  update public.web_sessions
     set revoked_at = now(),
         last_seen_at = now()
   where user_id = _user_id
     and revoked_at is null;
end;
$$;

-- colleges, startups, student_profiles: all carry user_id.
create or replace function public.revoke_sessions_on_account_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    perform public.revoke_sessions_if_not_allowed(old.user_id);
    return old;
  end if;

  perform public.revoke_sessions_if_not_allowed(new.user_id);

  -- The row was handed to another login: the previous owner is judged as well.
  if old.user_id is distinct from new.user_id then
    perform public.revoke_sessions_if_not_allowed(old.user_id);
  end if;

  return new;
end;
$$;

create or replace function public.revoke_sessions_on_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The session was issued for the old role; whatever the new state is, it must sign in again.
  update public.web_sessions
     set revoked_at = now(),
         last_seen_at = now()
   where user_id = old.user_id
     and revoked_at is null;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.revoke_sessions_if_not_allowed(uuid) from public, anon, authenticated;
revoke all on function public.revoke_sessions_on_account_change() from public, anon, authenticated;
revoke all on function public.revoke_sessions_on_role_change() from public, anon, authenticated;
grant execute on function public.revoke_sessions_if_not_allowed(uuid) to service_role;

drop trigger if exists revoke_sessions_when_access_ends on public.colleges;
create trigger revoke_sessions_when_access_ends
  after delete or update of status, verification_status, user_id, name on public.colleges
  for each row execute function public.revoke_sessions_on_account_change();

drop trigger if exists revoke_sessions_when_access_ends on public.startups;
create trigger revoke_sessions_when_access_ends
  after delete or update of status, verification_status, user_id, name on public.startups
  for each row execute function public.revoke_sessions_on_account_change();

drop trigger if exists revoke_sessions_when_access_ends on public.student_profiles;
create trigger revoke_sessions_when_access_ends
  after delete or update of status, onboarding_status, college_id, user_id, full_name on public.student_profiles
  for each row execute function public.revoke_sessions_on_account_change();

drop trigger if exists revoke_sessions_when_role_changes on public.user_roles;
create trigger revoke_sessions_when_role_changes
  after delete or update of role, user_id on public.user_roles
  for each row execute function public.revoke_sessions_on_role_change();

do $$
declare
  fn text;
  tbl text;
begin
  foreach fn in array array[
    'public.revoke_sessions_if_not_allowed(uuid)',
    'public.revoke_sessions_on_account_change()',
    'public.revoke_sessions_on_role_change()'
  ] loop
    if to_regprocedure(fn) is null then
      raise exception '101 self-check: % missing', fn;
    end if;
    if has_function_privilege('anon', fn, 'execute')
       or has_function_privilege('authenticated', fn, 'execute') then
      raise exception '101 self-check: a browser role can call %', fn;
    end if;
  end loop;

  foreach tbl in array array['colleges', 'startups', 'student_profiles'] loop
    if not exists (
      select 1 from pg_trigger
       where tgname = 'revoke_sessions_when_access_ends'
         and tgrelid = ('public.' || tbl)::regclass
         and not tgisinternal
    ) then
      raise exception '101 self-check: session trigger missing on %', tbl;
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger
     where tgname = 'revoke_sessions_when_role_changes'
       and tgrelid = 'public.user_roles'::regclass
  ) then
    raise exception '101 self-check: session trigger missing on user_roles';
  end if;

  -- The rule this depends on must still be server-only.
  if has_function_privilege('authenticated', 'public.web_login_identity(uuid)', 'execute') then
    raise exception '101 self-check: web_login_identity is callable from a browser role';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
