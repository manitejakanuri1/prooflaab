-- 110: one Google-login lifecycle for EVERY role (student, college_admin, startup, recruiter, admin).
--
-- Before: only students were compared with Google (accounts /sync, migration 55 ledger account_sync_missing),
-- and only students could delete their own account. A college, company, recruiter or admin whose Google login
-- was deleted in the Console kept working with any ticket already issued (up to an hour), and the BFF session
-- stayed open until its own re-check.
--
-- Now:
--   identity_lifecycle        one server-only, append-mostly ledger. Each row is ONE event about ONE login,
--                             keyed by the exact {identity_project, tenant_id, provider_uid} (never by email)
--                             and the internal account uuid. Two directions:
--                               console: observed_missing -> verified_missing (access cut) -> recovered
--                               app:     requested / pending (retrying) -> completed | failed (needs a person)
--                             event_key makes every write idempotent; a second open console row for the same
--                             scoped login is impossible (partial unique index).
--   access cut, everywhere    a row with access_blocked = true:
--                               * revokes that account's web_sessions at once (trigger, all roles);
--                               * account_is_suspended() answers true -> the API pre-request hook (73) refuses
--                                 every old ticket, the functions service refuses within 30 s;
--                               * web_login_identity() answers allowed=false -> BFF sign-in and re-check refuse;
--                               * resolve_account() refuses -> the auth-bridge issues no new ticket;
--                               * account_access_ok() (new) -> the file service refuses old tickets.
--                             Nothing else is touched: no college, company, squad or other person changes.
--   students                  as before, a student whose login is confirmed missing is also SUSPENDED
--                             (hidden from Lots, leaderboards, recruiters) and restored when the same login
--                             comes back. Nothing is ever deleted by the sync.
--   protected test accounts   can never be blocked (trigger) or deleted through these functions.
--   last admin                cannot be deleted through the app.
--
-- account_sync_missing (51/55) is copied into the ledger and is no longer written; it is kept, not dropped,
-- so the rollback can hand suspensions back to the old code.
-- Needs 55 (protected_test_accounts), 73 (account_is_suspended), 95 (web_sessions), 102 (web_login_identity).
-- Rollback: 110-rollback-identity-lifecycle-all-roles.sql.
begin;

do $$
begin
  if to_regclass('public.web_sessions') is null
     or to_regclass('public.protected_test_accounts') is null
     or to_regclass('public.account_sync_missing') is null
     or to_regclass('public.account_identities') is null
     or to_regprocedure('public.account_is_suspended(uuid)') is null
     or to_regprocedure('public.resolve_account(text,text,boolean)') is null
     or to_regprocedure('public.resolve_account_uuid(text,text)') is null
     or (to_regprocedure('public.web_login_identity(uuid)') is null
         and to_regprocedure('public.web_login_identity_base(uuid)') is null) then
    raise exception '110 requires migrations 05, 11, 55, 73, 95 and 102';
  end if;
end $$;

-- ------------------------------------------------------------------ the ledger
create table if not exists public.identity_lifecycle (
  id               bigint generated always as identity primary key,
  event_key        text not null unique check (length(event_key) between 8 and 300),
  user_id          uuid not null,                 -- no FK: the audit row outlives a deleted account
  role_snapshot    text,
  identity_project text not null check (identity_project <> ''),
  tenant_id        text not null default '',
  provider_uid     text not null check (provider_uid <> ''),
  direction        text not null check (direction in ('console', 'app')),
  status           text not null check (status in ('observed_missing', 'verified_missing', 'recovered',
                                                    'requested', 'pending', 'completed', 'failed', 'cancelled')),
  access_blocked   boolean not null default false,
  student_suspended boolean not null default false, -- this row suspended the student; recovery restores it
  actor            text not null,                    -- 'sync', 'self:<uuid>', 'admin:<uuid>', 'college:<uuid>', 'backfill'
  reason           text,
  attempts         integer not null default 0,
  next_attempt_at  timestamptz,
  last_error       text,
  event_at         timestamptz not null default now(),
  verified_at      timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint identity_lifecycle_direction_status check (
    (direction = 'console' and status in ('observed_missing', 'verified_missing', 'recovered'))
    or (direction = 'app' and status in ('requested', 'pending', 'completed', 'failed', 'cancelled')))
);
comment on table public.identity_lifecycle is
  'Server-only Google-login lifecycle ledger for every role (migration 110). Browser roles: no access.';

create unique index if not exists identity_lifecycle_one_open_console
  on public.identity_lifecycle (identity_project, tenant_id, provider_uid)
  where direction = 'console' and status in ('observed_missing', 'verified_missing');
create unique index if not exists identity_lifecycle_one_open_app
  on public.identity_lifecycle (user_id)
  where direction = 'app' and status in ('requested', 'pending', 'failed');
create index if not exists identity_lifecycle_blocked on public.identity_lifecycle (user_id) where access_blocked;
create index if not exists identity_lifecycle_due on public.identity_lifecycle (next_attempt_at)
  where direction = 'app' and status in ('requested', 'pending');

alter table public.identity_lifecycle enable row level security;
-- revoke from service_role too: the default privileges grant it ALL on new tables; it gets exactly these back.
revoke all on public.identity_lifecycle from public, anon, authenticated, service_role;
grant select, insert, update on public.identity_lifecycle to service_role;
revoke delete, truncate on public.identity_lifecycle from service_role;   -- audit rows are never removed by the app
grant usage on sequence public.identity_lifecycle_id_seq to service_role;

-- Accounts whose AUTOMATIC reconciliation is on hold (owner decision, 13 Oct 2026: staging accounts linked to a
-- personal mailbox, until their ownership is verified). The sync neither marks, cuts nor links them; their data is
-- untouched. Rows are added/removed only by a person with direct SQL (no API grant beyond reading).
create table if not exists public.identity_reconcile_hold (
  user_id    uuid primary key,
  reason     text not null check (length(reason) between 3 and 300),
  held_by    text not null,
  created_at timestamptz not null default now()
);
alter table public.identity_reconcile_hold enable row level security;
-- revoke from service_role too: staging/production grant it ALL on new tables by default privileges (seen 13 Oct).
revoke all on public.identity_reconcile_hold from public, anon, authenticated, service_role;
grant select on public.identity_reconcile_hold to service_role;

-- Protected test accounts can never be blocked, by any path.
create or replace function public.identity_lifecycle_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.access_blocked and exists (select 1 from public.protected_test_accounts t where t.user_id = new.user_id) then
    raise exception 'account % is a protected test fixture; its access cannot be cut', new.user_id
      using errcode = 'P0001', hint = 'protected_account';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.identity_lifecycle_guard() from public, anon, authenticated;
drop trigger if exists identity_lifecycle_guard on public.identity_lifecycle;
create trigger identity_lifecycle_guard before insert or update on public.identity_lifecycle
  for each row execute function public.identity_lifecycle_guard();

-- Cutting access ends every open web session of that ONE account, whatever its role.
create or replace function public.identity_lifecycle_revoke_sessions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.access_blocked and (tg_op = 'INSERT' or not old.access_blocked) then
    update public.web_sessions set revoked_at = now(), last_seen_at = now()
     where user_id = new.user_id and revoked_at is null;
  end if;
  return new;
end $$;
revoke all on function public.identity_lifecycle_revoke_sessions() from public, anon, authenticated;
drop trigger if exists identity_lifecycle_revoke_sessions on public.identity_lifecycle;
create trigger identity_lifecycle_revoke_sessions after insert or update of access_blocked on public.identity_lifecycle
  for each row execute function public.identity_lifecycle_revoke_sessions();

-- ------------------------------------------------------------------ one question, asked everywhere
create or replace function public.identity_access_blocked(_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.identity_lifecycle l where l.user_id = _user and l.access_blocked);
$$;
revoke all on function public.identity_access_blocked(uuid) from public, anon, authenticated;
grant execute on function public.identity_access_blocked(uuid) to service_role;

-- 73's body plus the ledger. Same signature, owner and grants, so the API hook and the functions service
-- need no change.
create or replace function public.account_is_suspended(_user uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select exists (select 1 from public.student_profiles p where p.id = _user and p.status = 'suspended')
      or public.identity_access_blocked(_user);
$function$;
revoke all on function public.account_is_suspended(uuid) from public, anon, authenticated;
grant execute on function public.account_is_suspended(uuid) to service_role;

-- The file service asks with the CALLER's own ticket (it holds no server credential for the API).
create or replace function public.account_access_ok()
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare uid uuid;
begin
  begin
    uid := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
  exception when others then
    return false;
  end;
  return uid is not null and not public.account_is_suspended(uid);
end $$;
revoke all on function public.account_access_ok() from public, anon;
grant execute on function public.account_access_ok() to authenticated, service_role;

-- web_login_identity: 102's function is kept unchanged under a new name; the public name now asks the
-- ledger first. Callers (BFF, 101's triggers) resolve the name at run time, so all of them get the check.
do $$
begin
  if to_regprocedure('public.web_login_identity_base(uuid)') is null then
    alter function public.web_login_identity(uuid) rename to web_login_identity_base;
  end if;
end $$;
revoke all on function public.web_login_identity_base(uuid) from public, anon, authenticated;
grant execute on function public.web_login_identity_base(uuid) to service_role;

create or replace function public.web_login_identity(_user_id uuid)
returns jsonb language plpgsql security definer volatile set search_path = public, pg_temp as $$
begin
  if public.identity_access_blocked(_user_id) then
    return jsonb_build_object('allowed', false, 'reason', 'identity_missing');
  end if;
  return public.web_login_identity_base(_user_id);
end $$;
revoke all on function public.web_login_identity(uuid) from public, anon, authenticated;
grant execute on function public.web_login_identity(uuid) to service_role;

-- resolve_account: migration 11 verbatim, plus one refusal before anything is written.
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

  -- 110: a login whose account is cut off (Google login deleted/disabled, or deletion in progress) gets no ticket.
  if public.identity_access_blocked(_uuid) then
    raise exception 'this account is no longer active' using errcode = 'P0001', hint = 'identity_blocked';
  end if;
  -- 110: a uuid-named login (Google id == app id) is recorded as LINKED the first time it signs in, so the sync
  -- reconciles it from then on. Never replaces an existing mapping.
  if _provider_uid = _uuid::text then
    insert into public.account_identities (provider_uid, user_id, email)
    values (_provider_uid, _uuid, lower(nullif(trim(coalesce(_email, '')), '')))
    on conflict do nothing;
  end if;

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

-- ------------------------------------------------------------------ Google Console -> app (the sync)
-- Every account with a role, its exact login id, whether that login is LINKED (an account_identities row), and
-- where it stands in the ledger for THIS identity scope. Only linked logins are reconciled (accounts/sync_plan.py):
-- an account that never had a Google login (e.g. synthetic staging students) is never treated as a deleted one.
create or replace function public.identity_sync_accounts(_project text, _tenant text default '')
returns table (user_id uuid, role text, provider_uid text, linked boolean, protected boolean, on_hold boolean,
               ledger_status text, first_missing_at timestamptz, in_app_deletion boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.user_id, r.role::text, coalesce(ai.provider_uid, r.user_id::text), ai.provider_uid is not null,
         exists (select 1 from public.protected_test_accounts t where t.user_id = r.user_id),
         exists (select 1 from public.identity_reconcile_hold h where h.user_id = r.user_id),
         l.status, l.event_at,
         exists (select 1 from public.identity_lifecycle a
                  where a.user_id = r.user_id and a.direction = 'app' and a.status <> 'cancelled')
    from public.user_roles r
    left join public.account_identities ai on ai.user_id = r.user_id
    left join public.identity_lifecycle l
           on l.direction = 'console' and l.status in ('observed_missing', 'verified_missing')
          and l.identity_project = _project and l.tenant_id = coalesce(_tenant, '')
          and l.provider_uid = coalesce(ai.provider_uid, r.user_id::text) and l.user_id = r.user_id;
$$;

-- Links uuid-named logins (August accounts: Google id == app id, no mapping row) that the sync SAW in the listing.
-- Only an account whose own id is its login id, and that has no mapping yet; anything else is skipped.
create or replace function public.identity_link_present(_rows jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare e jsonb; n int := 0; k int; uid uuid;
begin
  for e in select * from jsonb_array_elements(coalesce(_rows, '[]'::jsonb)) loop
    uid := (e ->> 'user_id')::uuid;
    continue when e ->> 'provider_uid' is distinct from uid::text;
    continue when not exists (select 1 from public.user_roles r where r.user_id = uid);
    continue when exists (select 1 from public.identity_reconcile_hold h where h.user_id = uid);
    insert into public.account_identities (provider_uid, user_id) values (uid::text, uid) on conflict do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;

-- Applies one sync pass's decisions (accounts/sync_plan.py) in one transaction. Each entry names the account
-- AND its exact login id; an entry that no longer matches the database is skipped, never guessed.
create or replace function public.identity_sync_apply(_project text, _tenant text, _mark jsonb, _verified jsonb,
                                                      _recover jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t text := coalesce(_tenant, '');
  e jsonb; n_mark int := 0; n_ver int := 0; n_susp int := 0; n_rec int := 0; n_rest int := 0; n_skip int := 0;
  k int; row_id bigint; stu boolean;
begin
  if coalesce(_project, '') = '' then
    raise exception 'identity_sync_apply needs the identity project';
  end if;

  for e in select * from jsonb_array_elements(coalesce(_mark, '[]'::jsonb)) loop
    if exists (select 1 from public.protected_test_accounts p where p.user_id = (e ->> 'user_id')::uuid)
       or exists (select 1 from public.identity_reconcile_hold h where h.user_id = (e ->> 'user_id')::uuid) then
      n_skip := n_skip + 1; continue;
    end if;
    insert into public.identity_lifecycle (event_key, user_id, role_snapshot, identity_project, tenant_id, provider_uid,
                                           direction, status, actor, reason)
    values (format('console:%s:%s:%s:%s', _project, t, e ->> 'provider_uid',
                   floor(extract(epoch from clock_timestamp()) * 1000)::bigint),
            (e ->> 'user_id')::uuid, e ->> 'role', _project, t, e ->> 'provider_uid',
            'console', 'observed_missing', 'sync', 'absent from the Identity listing')
    on conflict do nothing;
    get diagnostics k = row_count; n_mark := n_mark + k;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(_verified, '[]'::jsonb)) loop
    if exists (select 1 from public.protected_test_accounts p where p.user_id = (e ->> 'user_id')::uuid)
       or exists (select 1 from public.identity_reconcile_hold h where h.user_id = (e ->> 'user_id')::uuid) then
      n_skip := n_skip + 1; continue;
    end if;
    update public.identity_lifecycle l
       set status = 'verified_missing', access_blocked = true, verified_at = now(),
           reason = coalesce(e ->> 'reason', 'login not found by exact lookup')
     where l.direction = 'console' and l.status = 'observed_missing' and l.identity_project = _project
       and l.tenant_id = t and l.provider_uid = e ->> 'provider_uid' and l.user_id = (e ->> 'user_id')::uuid
    returning l.id, l.role_snapshot = 'student' into row_id, stu;
    if row_id is null then n_skip := n_skip + 1; continue; end if;
    n_ver := n_ver + 1;
    if stu then
      update public.student_profiles sp set status = 'suspended', updated_at = now()
       where sp.id = (e ->> 'user_id')::uuid and sp.status = 'active';
      get diagnostics k = row_count;
      if k > 0 then
        update public.identity_lifecycle set student_suspended = true where id = row_id;
        n_susp := n_susp + 1;
      end if;
    end if;
    row_id := null;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(_recover, '[]'::jsonb)) loop
    update public.identity_lifecycle l
       set status = 'recovered', access_blocked = false, completed_at = now(),
           reason = coalesce(l.reason, '') || '; same login id is present again'
     where l.direction = 'console' and l.status in ('observed_missing', 'verified_missing')
       and l.identity_project = _project and l.tenant_id = t
       and l.provider_uid = e ->> 'provider_uid' and l.user_id = (e ->> 'user_id')::uuid
    returning l.id, l.student_suspended into row_id, stu;
    if row_id is null then n_skip := n_skip + 1; continue; end if;
    n_rec := n_rec + 1;
    if stu then
      -- Only a suspension THIS ledger made is undone; any other suspension stays.
      update public.student_profiles sp set status = 'active', updated_at = now()
       where sp.id = (e ->> 'user_id')::uuid and sp.status = 'suspended';
      get diagnostics k = row_count; n_rest := n_rest + k;
    end if;
    row_id := null;
  end loop;

  return jsonb_build_object('marked', n_mark, 'verified', n_ver, 'suspended', n_susp,
                            'recovered', n_rec, 'restored', n_rest, 'skipped', n_skip);
end $$;

-- ------------------------------------------------------------------ app -> Google (deletion outbox)
-- A non-student account asks to be deleted (self, typing DELETE) or an administrator deletes it.
-- Policy (retention): the PERSON's login is removed and access is cut for good; the account's records and
-- every organisation record (college, company, recruiter row, squads, other people) are KEPT. Deleting an
-- organisation is a different, separate action and is not done here. Students go through remove_students.
create or replace function public.identity_request_deletion(_target uuid, _by uuid, _confirm text,
                                                            _project text, _tenant text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_role text; by_role text; uid text; r public.identity_lifecycle; how text;
begin
  if _target is null or _by is null or coalesce(_project, '') = '' then
    raise exception 'target, caller and identity project are required';
  end if;
  select role::text into target_role from public.user_roles where user_id = _target;
  select role::text into by_role from public.user_roles where user_id = _by;
  if target_role is null then
    raise exception 'no such account' using hint = 'not_found';
  end if;
  if target_role = 'student' then
    raise exception 'students are removed through remove_students' using hint = 'use_remove';
  end if;
  if _by = _target and _confirm = 'DELETE' then
    how := 'self';
  elsif by_role = 'admin' and not public.identity_access_blocked(_by) then
    how := 'admin';
  else
    raise exception 'you may not delete this account' using hint = 'forbidden';
  end if;
  if exists (select 1 from public.protected_test_accounts t where t.user_id = _target) then
    raise exception 'protected test account' using hint = 'protected_account';
  end if;

  select * into r from public.identity_lifecycle
   where user_id = _target and direction = 'app' and status in ('requested', 'pending', 'failed', 'completed')
   order by id desc limit 1;
  if found then
    return jsonb_build_object('id', r.id, 'provider_uid', r.provider_uid, 'status', r.status,
                              'role', r.role_snapshot, 'already', true);
  end if;

  if target_role = 'admin' and (select count(*) from public.user_roles u
                                 where u.role = 'admin' and u.user_id <> _target
                                   and not public.identity_access_blocked(u.user_id)) = 0 then
    raise exception 'the last active administrator cannot be deleted' using hint = 'last_admin';
  end if;

  select coalesce((select ai.provider_uid from public.account_identities ai where ai.user_id = _target),
                  _target::text) into uid;
  insert into public.identity_lifecycle (event_key, user_id, role_snapshot, identity_project, tenant_id, provider_uid,
                                         direction, status, access_blocked, actor, reason, next_attempt_at)
  values (format('app:%s:%s:%s:%s', target_role, _target, _project, uid), _target, target_role, _project,
          coalesce(_tenant, ''), uid, 'app', 'requested', true, how || ':' || _by, 'account deletion requested', now())
  returning * into r;
  return jsonb_build_object('id', r.id, 'provider_uid', r.provider_uid, 'status', r.status,
                            'role', r.role_snapshot, 'already', false);
end $$;

-- Students removed by remove_students (self, college or admin): one outbox row each, so a failed Google delete
-- is retried later instead of being forgotten. Idempotent by event_key.
create or replace function public.identity_record_student_removals(_rows jsonb, _actor text, _project text,
                                                                   _tenant text default '')
returns table (id bigint, user_id uuid, provider_uid text, status text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare e jsonb; uid text;
begin
  if coalesce(_project, '') = '' or coalesce(_actor, '') = '' then
    raise exception 'actor and identity project are required';
  end if;
  for e in select * from jsonb_array_elements(coalesce(_rows, '[]'::jsonb)) loop
    uid := nullif(e ->> 'provider_uid', '');
    insert into public.identity_lifecycle as l (event_key, user_id, role_snapshot, identity_project, tenant_id,
                                                provider_uid, direction, status, access_blocked, actor, reason,
                                                next_attempt_at, last_error)
    values (format('app:student:%s:%s:%s', e ->> 'student_id', _project, coalesce(uid, 'none')),
            (e ->> 'student_id')::uuid, 'student', _project, coalesce(_tenant, ''), coalesce(uid, 'none'),
            'app', case when uid is null then 'failed' else 'pending' end,
            not exists (select 1 from public.protected_test_accounts t where t.user_id = (e ->> 'student_id')::uuid),
            _actor, 'student removed', now(), case when uid is null then 'no login id on record' end)
    on conflict (event_key) do nothing;
  end loop;
  return query
    select l.id, l.user_id, l.provider_uid, l.status from public.identity_lifecycle l
     where l.direction = 'app' and l.identity_project = _project and l.tenant_id = coalesce(_tenant, '')
       and l.event_key in (select format('app:student:%s:%s:%s', x ->> 'student_id', _project,
                                         coalesce(nullif(x ->> 'provider_uid', ''), 'none'))
                             from jsonb_array_elements(coalesce(_rows, '[]'::jsonb)) x);
end $$;

-- Rows whose Google delete is due, in this identity scope only. Least-tried first, so one stuck login
-- cannot hold the others up.
create or replace function public.identity_due_deletions(_project text, _tenant text default '', _limit int default 10)
returns table (id bigint, user_id uuid, role_snapshot text, provider_uid text, attempts int)
language sql stable security definer set search_path = public, pg_temp as $$
  select l.id, l.user_id, l.role_snapshot, l.provider_uid, l.attempts from public.identity_lifecycle l
   where l.direction = 'app' and l.status in ('requested', 'pending')
     and l.identity_project = _project and l.tenant_id = coalesce(_tenant, '')
     and coalesce(l.next_attempt_at, '-infinity') <= now()
   order by l.attempts, l.created_at
   limit greatest(1, least(coalesce(_limit, 10), 50));
$$;

-- Records one Google delete attempt. Success only on a confirmed delete (or a scoped USER_NOT_FOUND, decided by
-- the caller after an exact lookup). Failure: exponential backoff 1, 2, 4 ... minutes, capped at 6 hours; after
-- 8 failures the row is 'failed' and needs a person (access stays cut either way).
create or replace function public.identity_attempt_result(_id bigint, _deleted boolean, _error text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare s text;
begin
  update public.identity_lifecycle l
     set status = case when _deleted then 'completed'
                       when l.attempts + 1 >= 8 then 'failed' else 'pending' end,
         completed_at = case when _deleted then now() end,
         attempts = l.attempts + case when _deleted then 0 else 1 end,
         last_error = case when _deleted then null else left(coalesce(_error, 'unknown'), 300) end,
         next_attempt_at = case when _deleted then null
                                else now() + least(interval '6 hours', interval '1 minute' * power(2, l.attempts)) end
   where l.id = _id and l.direction = 'app' and l.status in ('requested', 'pending')
  returning l.status into s;
  return s;     -- null: no such open row (already finished by another run) - nothing changed
end $$;

-- Alerting: anything stuck. Logged by every sync run; the log line drives an alert policy.
create or replace function public.identity_lifecycle_health()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'pending_over_1h', (select count(*) from public.identity_lifecycle
                         where direction = 'app' and status in ('requested', 'pending') and created_at < now() - interval '1 hour'),
    'failed', (select count(*) from public.identity_lifecycle where direction = 'app' and status = 'failed'),
    'blocked_accounts', (select count(distinct user_id) from public.identity_lifecycle where access_blocked),
    'observed_missing', (select count(*) from public.identity_lifecycle where direction = 'console' and status = 'observed_missing'));
$$;

-- Admin status report (read-only). Login ids are shown only as their last 4 characters.
create or replace function public.admin_identity_lifecycle(_limit int default 100)
returns table (id bigint, user_id uuid, role_snapshot text, direction text, status text, access_blocked boolean,
               provider_uid_tail text, actor text, reason text, attempts int, last_error text,
               event_at timestamptz, completed_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'administrators only' using errcode = '42501';
  end if;
  return query
    select l.id, l.user_id, l.role_snapshot, l.direction, l.status, l.access_blocked, right(l.provider_uid, 4),
           l.actor, l.reason, l.attempts, l.last_error, l.event_at, l.completed_at, l.updated_at
      from public.identity_lifecycle l order by l.updated_at desc limit greatest(1, least(coalesce(_limit, 100), 500));
end $$;

revoke all on function public.identity_sync_accounts(text, text) from public, anon, authenticated;
revoke all on function public.identity_sync_apply(text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.identity_link_present(jsonb) from public, anon, authenticated;
revoke all on function public.identity_request_deletion(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.identity_record_student_removals(jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.identity_due_deletions(text, text, int) from public, anon, authenticated;
revoke all on function public.identity_attempt_result(bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.identity_lifecycle_health() from public, anon, authenticated;
revoke all on function public.admin_identity_lifecycle(int) from public, anon;
grant execute on function public.identity_sync_accounts(text, text) to service_role;
grant execute on function public.identity_sync_apply(text, text, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.identity_link_present(jsonb) to service_role;
grant execute on function public.identity_request_deletion(uuid, uuid, text, text, text) to service_role;
grant execute on function public.identity_record_student_removals(jsonb, text, text, text) to service_role;
grant execute on function public.identity_due_deletions(text, text, int) to service_role;
grant execute on function public.identity_attempt_result(bigint, boolean, text) to service_role;
grant execute on function public.identity_lifecycle_health() to service_role;
grant execute on function public.admin_identity_lifecycle(int) to authenticated, service_role;

-- ------------------------------------------------------------------ carry the student ledger over
-- Every existing row was observed against the one Identity project in use until now.
insert into public.identity_lifecycle (event_key, user_id, role_snapshot, identity_project, tenant_id, provider_uid,
                                       direction, status, access_blocked, student_suspended, actor, reason,
                                       event_at, verified_at)
select 'backfill:account_sync_missing:' || m.student_id, m.student_id, 'student', 'prooflab-508214', '',
       m.provider_uid, 'console',
       case when m.suspended_at is not null then 'verified_missing' else 'observed_missing' end,
       m.suspended_at is not null
         and not exists (select 1 from public.protected_test_accounts t where t.user_id = m.student_id),
       m.suspended_at is not null, 'backfill', 'copied from account_sync_missing (migration 110)',
       m.first_missing_at, m.suspended_at
  from public.account_sync_missing m
 where m.provider_uid is not null
on conflict do nothing;

-- ------------------------------------------------------------------ self-check
do $$
declare
  probe uuid := gen_random_uuid();
  f text;
  r jsonb;
begin
  -- browser roles: nothing on the ledger, no server-only function
  if has_table_privilege('anon', 'public.identity_lifecycle', 'select')
     or has_table_privilege('authenticated', 'public.identity_lifecycle', 'select')
     or has_table_privilege('authenticated', 'public.identity_lifecycle', 'insert')
     or has_table_privilege('authenticated', 'public.identity_lifecycle', 'update') then
    raise exception '110 self-check: a browser role can touch identity_lifecycle';
  end if;
  if has_table_privilege('authenticated', 'public.identity_reconcile_hold', 'select')
     or has_table_privilege('service_role', 'public.identity_reconcile_hold', 'insert')
     or has_table_privilege('service_role', 'public.identity_reconcile_hold', 'delete') then
    raise exception '110 self-check: the reconcile hold can be read by a browser or changed through the API';
  end if;
  if has_table_privilege('service_role', 'public.identity_lifecycle', 'delete') then
    raise exception '110 self-check: audit rows can be deleted through the API';
  end if;
  foreach f in array array['public.identity_access_blocked(uuid)', 'public.account_is_suspended(uuid)',
      'public.web_login_identity(uuid)', 'public.web_login_identity_base(uuid)',
      'public.resolve_account(text,text,boolean)', 'public.identity_sync_accounts(text,text)',
      'public.identity_sync_apply(text,text,jsonb,jsonb,jsonb)', 'public.identity_link_present(jsonb)',
      'public.identity_request_deletion(uuid,uuid,text,text,text)',
      'public.identity_record_student_removals(jsonb,text,text,text)',
      'public.identity_due_deletions(text,text,integer)', 'public.identity_attempt_result(bigint,boolean,text)',
      'public.identity_lifecycle_health()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '110 self-check: % is callable from a browser role', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '110 self-check: the server cannot call %', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.account_access_ok()', 'execute')
     or not has_function_privilege('authenticated', 'public.account_access_ok()', 'execute') then
    raise exception '110 self-check: account_access_ok grants are wrong';
  end if;

  -- behaviour, on a throwaway id that matches no real account (all probe rows removed below)
  if public.account_is_suspended(probe) or public.identity_access_blocked(probe) then
    raise exception '110 self-check: an unknown account reads as blocked';
  end if;
  insert into public.identity_lifecycle (event_key, user_id, identity_project, provider_uid, direction, status,
                                         access_blocked, actor)
  values ('selfcheck:110:' || probe, probe, 'selfcheck', probe::text, 'console', 'verified_missing', true, 'selfcheck');
  if not public.account_is_suspended(probe) then
    raise exception '110 self-check: a blocked account is not refused by account_is_suspended';
  end if;
  r := public.web_login_identity(probe);
  if coalesce((r ->> 'allowed')::boolean, true) or r ->> 'reason' <> 'identity_missing' then
    raise exception '110 self-check: web_login_identity allows a blocked account: %', r;
  end if;
  begin
    perform public.resolve_account(probe::text, null, false);
    raise exception '110 self-check: resolve_account issued for a blocked account';
  exception when others then
    if sqlerrm like '110 self-check%' then raise; end if;
  end;
  delete from public.identity_lifecycle where event_key = 'selfcheck:110:' || probe;
  if public.account_is_suspended(probe) then
    raise exception '110 self-check: probe row not removed';
  end if;
  r := public.web_login_identity(probe);
  if r ->> 'reason' = 'identity_missing' then
    raise exception '110 self-check: web_login_identity still blocks after release';
  end if;
  if (select count(*) from public.account_sync_missing m where m.provider_uid is not null)
     > (select count(*) from public.identity_lifecycle where actor = 'backfill') then
    raise exception '110 self-check: account_sync_missing was not fully copied';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
