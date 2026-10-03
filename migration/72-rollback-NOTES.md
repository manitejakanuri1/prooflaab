# Rollback of migration 72

Re-create `task_applications` from its original migration under `supabase/migrations/`, then reload rows:
`insert into public.task_applications select * from jsonb_populate_recordset(null::public.task_applications, (select jsonb_agg(row_data) from public.legacy_archive where source_table = 'task_applications'));`

Only needed if an older website build must run again. Staging rehearsal 3 Oct 2026: 0 rows.
