-- 86b: the backend role (service_role) may read account_identities, as on staging.
--
-- WHY. Found on a restored production copy (Stage 0.4 rehearsal, 6 Oct 2026): production grants
-- account_identities only to its owner ({prooflab_app=arwdDxtm/prooflab_app}); staging also grants
-- service_role. Migration 87's self-check requires service_role SELECT on every public table and
-- refuses otherwise ("postgres lost MAINTAIN or service_role lost SELECT on a public table").
-- SELECT only: no write, nothing for anon/authenticated. RLS stays on.
--
-- ORDER. After 86, before 87 (87 depends on it).
-- STAGING. service_role can already read it: this changes nothing.
-- Rollback: 86b-rollback-service-role-reads-account-identities.sql (only together with rolling back 87).
begin;

grant select on public.account_identities to service_role;

do $$
begin
  if not has_table_privilege('service_role', 'public.account_identities', 'select') then
    raise exception '86b self-check: service_role cannot read account_identities';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.account_identities'::regclass) then
    raise exception '86b self-check: row-level security is off on account_identities';
  end if;
end $$;

commit;
