# Rollback of migration 71 (two unused columns dropped)

Only needed if an OLDER website build (whose recorder still selects/inserts `proof_id`) must run again.

1. `alter table public.voice_explanations add column proof_id uuid;` (no foreign key: the proof table is gone after 66)
2. `alter table public.student_portfolios add column projects jsonb default '[]'::jsonb;`
3. Old values, if wanted: `update public.voice_explanations v set proof_id = (a.row_data->>'proof_id')::uuid from public.legacy_archive a where a.source_table = 'voice_explanations.proof_id' and (a.row_data->>'voice_id')::uuid = v.id;` and the same pattern for `student_portfolios.projects`.
4. Re-apply `guard_voice_explanations_insert()` from migration 65.
5. `notify pgrst, 'reload schema';`

Staging rehearsal 3 Oct 2026: 3 old `proof_id` values archived, 0 non-empty `projects`.
