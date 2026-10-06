-- 82b: the backend role (service_role) gets the default privileges staging already has, before 83 runs.
--
-- WHY. Found on a restored production copy (Stage 0.4 rehearsal, 6 Oct 2026, backup 1791144000000):
-- production has NO pg_default_acl rows at all (lost in the 1 Oct import); staging has
--   postgres / public / tables     service_role=arwdDxtm
--   postgres / public / sequences  service_role=rwU
--   postgres / public / functions  service_role=X
-- Migration 83 removes PUBLIC's built-in EXECUTE on new functions and states "service_role keeps its
-- defaults". Without this file 83's own self-check refuses on production (table:service_role-missing
-- function:service_role-missing), and every function made by 84-91 would be unusable by the backend.
--
-- ORDER. After 82, before 83 (83 depends on it). Affects only objects created AFTER it runs; existing
-- grants are untouched. Grants nothing to anon/authenticated.
-- STAGING. Already present there: running it changes nothing (ALTER DEFAULT PRIVILEGES ... GRANT is
-- idempotent). Rollback: migration/82b-rollback-service-role-default-privileges.sql (only valid together
-- with rolling back 83 and everything after it).
begin;

alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant usage, select, update on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

do $$
declare want record;
begin
  for want in select * from (values ('r', 'service_role=arwdDxtm/postgres'), ('S', 'service_role=rwU/postgres'),
                                    ('f', 'service_role=X/postgres')) v(objtype, entry) loop
    if not exists (select 1 from pg_default_acl d
                    where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
                      and d.defaclobjtype::text = want.objtype and want.entry = any(d.defaclacl::text[])) then
      raise exception '82b self-check: default privilege % (%) is not in place', want.entry, want.objtype;
    end if;
  end loop;
end $$;

commit;
