-- ============================================================================
-- Stage 35 — the recruiter role.
--
-- Alone in its own migration on purpose: Postgres will not let an enum value be
-- added and then used in the same transaction, and apply_migration wraps each
-- call in one. Everything that depends on 'recruiter' existing is in the next
-- file.
-- ============================================================================
alter type public.app_role add value if not exists 'recruiter';
