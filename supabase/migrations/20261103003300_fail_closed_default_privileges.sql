-- 83 (D2): new database objects are CLOSED by default.
--
-- WHY. Until now every table, sequence and function created by `postgres` (the only role that owns
-- application objects and runs migrations, measured 4 Oct) was automatically:
--   tables     anon/authenticated = arwdDxtm (read, insert, update, delete, truncate, ...)
--   sequences  anon/authenticated = rwU
--   functions  anon/authenticated = EXECUTE, and PUBLIC = EXECUTE (Postgres's built-in default)
-- so one forgotten `enable row level security` or `revoke` opened the object to anonymous callers.
-- That is exactly how skill_aliases (79), the 26 server-only functions (80), the 35 SQL-internal
-- functions (81) and notify_all_admins (82) became reachable.
--
-- WHAT CHANGES. Only objects created AFTER this migration. Existing grants are untouched.
-- service_role (the backend) keeps its defaults.
--
-- HOW FUTURE MIGRATIONS MUST GRANT (write it next to the CREATE):
--   table read by signed-in users:  alter table ... enable row level security; create policy ...;
--                                   grant select on public.<t> to authenticated;
--   table written by signed-in users: grant insert/update/delete as needed (still with RLS + policies)
--   identity/serial column inserted by signed-in users: grant usage on sequence public.<seq> to authenticated;
--   function called by signed-in users through the API: grant execute on function public.<f>(<args>) to authenticated;
--   server-only / SQL-internal function: grant nothing (service_role and the owner already can).
-- A forgotten grant now fails CLOSED ("permission denied", visible in the gate) instead of open.
begin;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
-- PUBLIC's EXECUTE on new functions is a built-in default: it can only be removed globally (no IN SCHEMA).
alter default privileges for role postgres revoke execute on functions from public;

-- Proof inside the migration: make one of each, check, drop. Nothing is left behind.
create table public.__d2_probe_table (id bigserial primary key, note text);
create function public.__d2_probe_fn() returns int language sql as 'select 1';

do $$
declare bad text := '';
begin
  if has_table_privilege('anon', 'public.__d2_probe_table', 'select,insert,update,delete,truncate,references,trigger')
     then bad := bad || ' table:anon'; end if;
  if has_table_privilege('authenticated', 'public.__d2_probe_table', 'select,insert,update,delete,truncate,references,trigger')
     then bad := bad || ' table:authenticated'; end if;
  if not has_table_privilege('service_role', 'public.__d2_probe_table', 'select,insert,update,delete') then bad := bad || ' table:service_role-missing'; end if;
  if has_sequence_privilege('anon', 'public.__d2_probe_table_id_seq', 'usage,select,update') then bad := bad || ' sequence:anon'; end if;
  if has_sequence_privilege('authenticated', 'public.__d2_probe_table_id_seq', 'usage,select,update') then bad := bad || ' sequence:authenticated'; end if;
  if has_function_privilege('anon', 'public.__d2_probe_fn()', 'execute') then bad := bad || ' function:anon'; end if;
  if has_function_privilege('authenticated', 'public.__d2_probe_fn()', 'execute') then bad := bad || ' function:authenticated'; end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.__d2_probe_fn()'::regprocedure and a.grantee = 0)
     or (select proacl is null from pg_proc where oid = 'public.__d2_probe_fn()'::regprocedure) then bad := bad || ' function:PUBLIC'; end if;
  if not has_function_privilege('service_role', 'public.__d2_probe_fn()', 'execute') then bad := bad || ' function:service_role-missing'; end if;
  if bad <> '' then raise exception '83 self-check: new objects are still open:%', bad; end if;
end $$;

drop function public.__d2_probe_fn();
drop table public.__d2_probe_table;

commit;
