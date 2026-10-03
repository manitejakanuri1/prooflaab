# Rollback of migration 66 (proof-era objects retired)

66 drops tables, functions and one column. It cannot be undone by a short script.
There are two ways back, in order of preference.

## 1. Restore the Cloud SQL backup taken just before 66
The rollout checklist requires an on-demand backup in the same hour. Restoring it
puts every object and row back exactly. This also discards anything written after
the backup, so it is only acceptable within the release window.

## 2. Rebuild the objects and reload the rows from `legacy_archive`
66 copies every row of every dropped table into `public.legacy_archive`
(`source_table`, `row_data` jsonb) before dropping, plus every non-zero
`student_profiles.trust_score`. To rebuild:

1. Re-create the tables, functions and triggers from the original migrations
   (`supabase/migrations/` history for proof_uploads, trust_scores, conceptual_*,
   proof_appeals, ai_verifications, github_verifications, coding_streaks, cosigns,
   recruiter_links, recruiter_link_views).
2. `alter table public.student_profiles add column trust_score numeric default 0;`
   and re-create `protect_student_profiles` with `'trust_score'` in its list.
3. Reload each table: `insert into public.<t> select * from jsonb_populate_recordset(null::public.<t>, (select jsonb_agg(row_data) from public.legacy_archive where source_table = '<t>'));`
4. `update public.student_profiles p set trust_score = (a.row_data->>'trust_score')::numeric from public.legacy_archive a where a.source_table = 'student_profiles.trust_score' and (a.row_data->>'student_id')::uuid = p.id;`
5. Re-add `voice_explanations_proof_id_fkey`.

The website and functions from this branch do not read any of these objects, so a
rollback of 66 is only needed if the OLD website/functions are redeployed.

## Staging rehearsal (2026-10-03)
Applied on staging. Archived: 1 proof_uploads row, 1 trust_scores row, 1 non-zero
trust score. After it: authz sweep 75/75, voice 14/14 + 11/11, F1 34/34, import 7/7,
browser 24/24 with no failed request.
