-- Rollback of 67: removes the ledger (the record of what was applied is lost; nothing else changes).
drop table if exists public.schema_migrations;
