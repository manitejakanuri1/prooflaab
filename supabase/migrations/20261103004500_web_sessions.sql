-- 95: server-side browser sessions for the ProofLab web BFF.
--
-- The browser receives only a random opaque session id. Its SHA-256 hash is
-- stored here; Google refresh tokens and ProofLab access tokens are encrypted
-- by the BFF before they reach this table.
--
-- Browser roles have no privileges. Only service_role may access sessions.
-- Additive migration: does not depend on destructive migration 94.
begin;

create table public.web_sessions (
  session_hash text primary key
    check (session_hash ~ '^[0-9a-f]{64}$'),

  user_id uuid not null,

  encrypted_payload text not null
    check (length(encrypted_payload) >= 32),

  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,

  constraint web_sessions_expiry_after_creation
    check (expires_at > created_at)
);

comment on table public.web_sessions is
  'Server-only BFF sessions. Browser holds only an opaque random id; credentials stay encrypted server-side.';

comment on column public.web_sessions.session_hash is
  'SHA-256 hex digest of the browser session id. The raw session id is never stored.';

comment on column public.web_sessions.encrypted_payload is
  'AES-GCM encrypted server-side session payload. Never returned to browser JavaScript.';

create index web_sessions_user_id_idx
  on public.web_sessions (user_id);

create index web_sessions_active_expiry_idx
  on public.web_sessions (expires_at)
  where revoked_at is null;

alter table public.web_sessions enable row level security;

revoke all on table public.web_sessions
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.web_sessions
  to service_role;

create policy web_sessions_service_role_only
  on public.web_sessions
  for all
  to service_role
  using (true)
  with check (true);

do $$
declare
  browser_leak boolean;
  service_missing boolean;
  rls_on boolean;
begin
  if to_regclass('public.web_sessions') is null then
    raise exception '95 self-check: web_sessions table missing';
  end if;

  select
    has_table_privilege('anon', 'public.web_sessions', 'select')
    or has_table_privilege('anon', 'public.web_sessions', 'insert')
    or has_table_privilege('anon', 'public.web_sessions', 'update')
    or has_table_privilege('anon', 'public.web_sessions', 'delete')
    or has_table_privilege('authenticated', 'public.web_sessions', 'select')
    or has_table_privilege('authenticated', 'public.web_sessions', 'insert')
    or has_table_privilege('authenticated', 'public.web_sessions', 'update')
    or has_table_privilege('authenticated', 'public.web_sessions', 'delete')
    into browser_leak;

  if browser_leak then
    raise exception '95 self-check: browser role can access web_sessions';
  end if;

  select not (
    has_table_privilege('service_role', 'public.web_sessions', 'select')
    and has_table_privilege('service_role', 'public.web_sessions', 'insert')
    and has_table_privilege('service_role', 'public.web_sessions', 'update')
    and has_table_privilege('service_role', 'public.web_sessions', 'delete')
  ) into service_missing;

  if service_missing then
    raise exception '95 self-check: service_role privileges missing';
  end if;

  select c.relrowsecurity
    into rls_on
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'web_sessions';

  if rls_on is not true then
    raise exception '95 self-check: RLS is not enabled';
  end if;

  if not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename = 'web_sessions'
       and policyname = 'web_sessions_service_role_only'
  ) then
    raise exception '95 self-check: service_role policy missing';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
