-- ROLLBACK 86b (production only; on staging service_role had this grant before 86b, so do not run it there).
-- Roll back 87 first, or 87's rule is false again.
begin;
revoke select on public.account_identities from service_role;
commit;
