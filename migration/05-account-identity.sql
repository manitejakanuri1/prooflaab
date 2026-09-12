-- Give every Google account a UUID of its own.
--
-- The problem this solves: Identity Platform names an account when it creates
-- one, and its names look like 96P7fbq09VWwtePxxXXDbDc3xm32. Every user column
-- in this database is uuid, and 264 auth.uid() comparisons expect one, so an
-- account named like that cannot be stored at all. Telling Identity Platform to
-- use a uuid instead needs an administrator credential, and the metadata server
-- on this runtime cannot issue one.
--
-- So the translation happens here instead. The auth-bridge, which already mints
-- every database token, asks this function for the uuid belonging to a Google
-- account and puts that in the token. The database only ever sees uuids, and no
-- administrator credential has to exist anywhere.
--
-- The seven accounts migrated in August kept their original uuids as their
-- Identity Platform ids, so for them this is the identity mapping: the uuid
-- comes back unchanged and nothing is written. Only accounts created after the
-- move get a new row.

begin;

create table if not exists public.account_identities (
  provider_uid text primary key,
  user_id uuid not null unique,
  email text,
  created_at timestamptz not null default now()
);

comment on table public.account_identities is
  'Maps an Identity Platform account id to the uuid this database uses. '
  'Written only by the auth-bridge, through resolve_account_uuid().';

alter table public.account_identities enable row level security;

-- No policies, deliberately. Nothing a browser holds should read this table:
-- it is a list of who exists. The bridge reaches it through the function below,
-- which is security definer and therefore not subject to policies.

revoke all on table public.account_identities from public, anon, authenticated;

/**
 * The uuid for a Google account, creating one the first time it is seen.
 *
 * Called by the auth-bridge on every token exchange, so it has to be cheap and
 * it has to be safe to call concurrently - two browser tabs signing in at the
 * same moment must not produce two different uuids for one person. The insert
 * is therefore idempotent, and the row is read back afterwards rather than
 * assumed.
 */
create or replace function public.resolve_account_uuid(
  _provider_uid text,
  _email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  _uuid uuid;
begin
  if _provider_uid is null or length(trim(_provider_uid)) = 0 then
    raise exception 'resolve_account_uuid needs a provider id';
  end if;

  -- The common case after the August migration: the Identity Platform id IS
  -- the uuid, because every account carried its original id across. Nothing to
  -- look up and nothing to write.
  begin
    _uuid := _provider_uid::uuid;
    return _uuid;
  exception when invalid_text_representation then
    null;  -- not a uuid, so it is a post-migration account; carry on below
  end;

  select user_id into _uuid
    from public.account_identities
   where provider_uid = _provider_uid;

  if _uuid is not null then
    return _uuid;
  end if;

  _uuid := gen_random_uuid();

  insert into public.account_identities (provider_uid, user_id, email)
  values (_provider_uid, _uuid, lower(nullif(trim(_email), '')))
  on conflict (provider_uid) do nothing;

  -- Read it back. If another request inserted first, that one wins and this
  -- returns theirs - which is the whole point of doing it this way.
  select user_id into _uuid
    from public.account_identities
   where provider_uid = _provider_uid;

  return _uuid;
end;
$$;

comment on function public.resolve_account_uuid(text, text) is
  'Server-side only. Returns the uuid for an Identity Platform account id, '
  'creating the mapping on first sight. Existing uuid-named accounts pass through.';

revoke all on function public.resolve_account_uuid(text, text) from public;
revoke all on function public.resolve_account_uuid(text, text) from anon, authenticated;
grant execute on function public.resolve_account_uuid(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- prove it behaves before committing
-- ---------------------------------------------------------------------------

do $$
declare
  a uuid;
  b uuid;
  passthrough uuid;
begin
  if has_function_privilege('anon', 'public.resolve_account_uuid(text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.resolve_account_uuid(text,text)', 'EXECUTE') then
    raise exception 'resolve_account_uuid is reachable by a browser role';
  end if;

  -- An id that is already a uuid must come back untouched, and must not create
  -- a row. This is what keeps the migrated accounts working.
  passthrough := public.resolve_account_uuid('5a0336c2-a17a-40b2-8849-ac6bc0707f75');
  if passthrough <> '5a0336c2-a17a-40b2-8849-ac6bc0707f75'::uuid then
    raise exception 'a uuid-named account did not pass through unchanged';
  end if;
  if exists (select 1 from public.account_identities
              where provider_uid = '5a0336c2-a17a-40b2-8849-ac6bc0707f75') then
    raise exception 'a uuid-named account should not need a mapping row';
  end if;

  -- A Google-style id must get a uuid, and the same id must get the same uuid
  -- every time. If this were not stable, a student would become a stranger to
  -- their own work on their next login.
  a := public.resolve_account_uuid('selftest-google-id-0001', 'selftest@prooflab.test');
  b := public.resolve_account_uuid('selftest-google-id-0001');
  if a is null or a <> b then
    raise exception 'the same account got two different uuids: % and %', a, b;
  end if;

  delete from public.account_identities where provider_uid = 'selftest-google-id-0001';

  raise notice 'resolve_account_uuid works: uuid ids pass through, new ids get a stable uuid';
end $$;

commit;
