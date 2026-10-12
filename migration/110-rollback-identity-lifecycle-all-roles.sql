-- 110 rollback. Order: first put accounts back on the image before 110 (its /sync uses account_sync_missing),
-- then run this. The file service may stay on the new image: account_access_ok() is KEPT here and then answers
-- with 73's rule (student suspension only).
--
-- What it does:
--   * account_is_suspended and resolve_account: exactly as migrations 73 and 11 left them;
--   * web_login_identity: 102's function gets its name back (the 110 wrapper is dropped);
--   * every student the ledger still holds as missing goes back into account_sync_missing (with suspended_at
--     when this ledger suspended them), so the old sync restores them when their login returns;
--   * the identity_* functions and the ledger triggers are dropped.
-- The identity_lifecycle TABLE is kept as an audit record (nothing reads it after this). Dropping it is a
-- separate decision for the owner.
begin;

insert into public.account_sync_missing (student_id, provider_uid, first_missing_at, suspended_at)
select l.user_id, l.provider_uid, l.event_at, case when l.student_suspended then coalesce(l.verified_at, now()) end
  from public.identity_lifecycle l
  join public.student_profiles p on p.id = l.user_id
 where l.direction = 'console' and l.status in ('observed_missing', 'verified_missing')
on conflict (student_id) do update
  set suspended_at = coalesce(public.account_sync_missing.suspended_at, excluded.suspended_at);

drop trigger if exists identity_lifecycle_revoke_sessions on public.identity_lifecycle;
drop trigger if exists identity_lifecycle_guard on public.identity_lifecycle;
drop function if exists public.identity_lifecycle_revoke_sessions();
drop function if exists public.identity_lifecycle_guard();
drop function if exists public.identity_sync_accounts(text, text);
drop function if exists public.identity_sync_apply(text, text, jsonb, jsonb, jsonb);
drop function if exists public.identity_request_deletion(uuid, uuid, text, text, text);
drop function if exists public.identity_record_student_removals(jsonb, text, text, text);
drop function if exists public.identity_due_deletions(text, text, int);
drop function if exists public.identity_attempt_result(bigint, boolean, text);
drop function if exists public.identity_lifecycle_health();
drop function if exists public.admin_identity_lifecycle(int);

create or replace function public.account_is_suspended(_user uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select exists (select 1 from public.student_profiles p where p.id = _user and p.status = 'suspended');
$function$;
revoke all on function public.account_is_suspended(uuid) from public, anon, authenticated;
grant execute on function public.account_is_suspended(uuid) to service_role;

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
begin
  if to_regprocedure('public.web_login_identity_base(uuid)') is not null then
    drop function if exists public.web_login_identity(uuid);
    alter function public.web_login_identity_base(uuid) rename to web_login_identity;
  end if;
end $$;
revoke all on function public.web_login_identity(uuid) from public, anon, authenticated;
grant execute on function public.web_login_identity(uuid) to service_role;

drop function if exists public.identity_access_blocked(uuid);

do $$
begin
  if to_regprocedure('public.web_login_identity_base(uuid)') is not null
     or to_regprocedure('public.web_login_identity(uuid)') is null then
    raise exception '110 rollback self-check: web_login_identity was not restored';
  end if;
  if pg_get_functiondef('public.account_is_suspended(uuid)'::regprocedure) like '%identity%'
     or pg_get_functiondef('public.resolve_account(text,text,boolean)'::regprocedure) like '%identity_access_blocked%' then
    raise exception '110 rollback self-check: a function still reads the ledger';
  end if;
  if has_function_privilege('authenticated', 'public.web_login_identity(uuid)', 'execute') then
    raise exception '110 rollback self-check: web_login_identity is callable from a browser role';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
