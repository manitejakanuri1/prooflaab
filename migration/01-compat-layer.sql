-- ============================================================================
-- Cloud migration, step 1 of N — make plain Postgres look enough like Supabase
-- that the schema restores untouched.
--
-- A straight pg_restore of this database into Cloud SQL fails, because 55 foreign
-- keys across 46 tables reference auth.users, 145 policies are granted to roles
-- named anon / authenticated / service_role, and 45 functions plus 264 policy
-- expressions call auth.uid(). None of those exist in stock Postgres - Supabase
-- supplies them.
--
-- Rather than rewrite 207 policies and 218 functions (which is where new
-- security holes get written), this recreates the four things they depend on.
-- Everything above stays exactly as it is today.
--
-- Run this on the EMPTY RDS database BEFORE restoring the dump.
-- ============================================================================

-- ── 1. the auth schema and a stand-in users table ───────────────────────────
-- Checked against the live database: all 55 foreign keys reference exactly one
-- column, auth.users.id (uuid). Only two functions read anything else -
-- student_profiles_create_contact and admin_users_write, both reading email -
-- so id and email is the whole requirement. The rest of Supabase's very wide
-- auth.users (tokens, confirmation timestamps, provider metadata) belongs to
-- GoTrue and has no business being copied into a database Cognito now feeds.
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key,
  email              text unique,
  -- The public.admin_users view reads both of these, so a restore fails
  -- without them - found by restoring and reading the error, not by guessing:
  --   COALESCE(NULLIF((u.raw_user_meta_data ->> 'full_name'), ''), ...)
  --   u.last_sign_in_at
  -- Both map onto Identity Platform concepts: custom claims, and the last
  -- sign-in timestamp. The post-login hook keeps them current.
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  last_sign_in_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Re-runnable: adds the columns to a table an earlier version of this file made.
alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb;
alter table auth.users add column if not exists last_sign_in_at    timestamptz;

comment on table auth.users is
  'Stand-in for Supabase auth.users. Rows mirror the Cognito user pool: the id
   is the Cognito sub, so every existing foreign key keeps working. Written by
   the post-confirmation Lambda, never by the app.';

-- ── 2. the three roles the policies are granted to ──────────────────────────
-- 145 policies name these. Without them, restore fails on "role does not
-- exist". They are nologin: nothing connects AS them. The API layer connects as
-- its own user and then SET ROLE, exactly as PostgREST does.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- bypassrls is what makes the service key ignore all 207 policies, which is
    -- the behaviour the edge functions already rely on.
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth   to anon, authenticated, service_role;

-- ── 3. auth.uid(), auth.jwt(), auth.role(), auth.email() ────────────────────
-- Copied verbatim from the live Supabase database, not reimplemented from
-- memory. They read a per-request setting; the API layer issues
--
--     SET LOCAL request.jwt.claims = '{"sub":"...","role":"authenticated"}';
--
-- before running the caller's query, which is precisely what PostgREST does.
-- Because the bodies are identical, all 264 call sites and 207 policies behave
-- exactly as they do today - nothing to re-verify.
create or replace function auth.uid()
returns uuid
language sql
stable
as $fn$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$fn$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $fn$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$fn$;

create or replace function auth.role()
returns text
language sql
stable
as $fn$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$fn$;

create or replace function auth.email()
returns text
language sql
stable
as $fn$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$fn$;

grant execute on function auth.uid(), auth.jwt(), auth.role(), auth.email()
  to anon, authenticated, service_role;

-- ── 4. prove it works before anything depends on it ─────────────────────────
do $$
declare
  test_id uuid := '11111111-2222-3333-4444-555555555555';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', test_id, 'role', 'authenticated',
                      'email', 'check@example.com')::text, true);

  if auth.uid() is distinct from test_id then
    raise exception 'auth.uid() returned %, expected %', auth.uid(), test_id;
  end if;
  if auth.role() is distinct from 'authenticated' then
    raise exception 'auth.role() returned %', auth.role();
  end if;
  if auth.email() is distinct from 'check@example.com' then
    raise exception 'auth.email() returned %', auth.email();
  end if;

  -- and that an absent claim is null rather than an error, which is what the
  -- policies assume for anonymous callers
  perform set_config('request.jwt.claims', '', true);
  if auth.uid() is not null then
    raise exception 'auth.uid() should be null with no claims, got %', auth.uid();
  end if;

  raise notice 'compat layer OK: auth.uid(), auth.role(), auth.email() all behave';
end $$;
