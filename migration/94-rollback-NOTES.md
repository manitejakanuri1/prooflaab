# Rollback of migration 94 (verification_settings, manual_adjustment_log dropped)

Only needed if an OLD (Supabase-era) website build must run again; the current website and
functions never read either table.

1. Restore the same-hour Cloud SQL backup (within the release window), or
2. Re-create each table from its original migration
   (`supabase/migrations/20260816000000_stage3_verification_engine.sql` for `verification_settings`
   with its trigger and policies; `supabase/migrations/20260821000000_stage14_admin_dashboard.sql`
   for `manual_adjustment_log`, plus the policy changes of stage63/stage66/stage67), then reload rows:
   `insert into public.<t> select * from jsonb_populate_recordset(null::public.<t>, (select jsonb_agg(row_data) from public.legacy_archive where source_table = '<t>'));`
3. `notify pgrst, 'reload schema';`

Staging rehearsal 7 Oct 2026: applied inside a transaction that was rolled back - see
docs/DEAD-CODE-AND-DATABASE-CLEANUP-2026-10-07.md.
