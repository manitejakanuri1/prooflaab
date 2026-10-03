-- 67: a ledger of applied migrations (Wave 9).
-- Until now "which migrations has this database had?" was answered from notes. The ledger
-- records each file by name with the SHA-256 of its text, so a database can say exactly
-- what it has, a file that changed after it was applied is caught, and staging and
-- production can be compared. Written by scripts/dev-tools/staging_migrate.py (and the
-- production runbook); never by the app.
begin;

create table if not exists public.schema_migrations (
  version text primary key,                 -- file name without .sql, e.g. '66-retire-proof-era-objects'
  checksum text not null,                   -- sha256 of the file as applied (LF line endings)
  applied_at timestamptz not null default now(),
  applied_by text not null default current_user,
  note text
);
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from public, anon, authenticated, service_role;
grant select on public.schema_migrations to service_role;

do $$
begin
  if has_table_privilege('authenticated', 'public.schema_migrations', 'select')
     or has_table_privilege('anon', 'public.schema_migrations', 'select') then
    raise exception '67 self-check: the ledger is readable from a browser';
  end if;
  if has_table_privilege('service_role', 'public.schema_migrations', 'insert') then
    raise exception '67 self-check: the app server can write the ledger';
  end if;
end $$;

commit;
