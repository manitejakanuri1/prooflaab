-- ROLLBACK 82b. Only together with rolling back 83 first (83-rollback), otherwise new functions made later
-- would be callable by nobody but their owner. On staging, where these defaults existed before 82b,
-- do NOT run this: 82b changed nothing there.
begin;
alter default privileges for role postgres in schema public revoke all on tables from service_role;
alter default privileges for role postgres in schema public revoke usage, select, update on sequences from service_role;
alter default privileges for role postgres in schema public revoke execute on functions from service_role;
commit;
