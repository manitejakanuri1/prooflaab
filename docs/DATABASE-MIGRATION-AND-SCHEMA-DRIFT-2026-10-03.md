# Database, migration and schema drift — 3 Oct 2026

## 1. Where the schema lives (F17, D1)

| Location | Files | Highest | Notes |
|---|---|---|---|
| `supabase/migrations/` | 139 | `20261101000000_college_reports_college_only.sql` | Supabase-era history + later mirrors (48, 49 mirrored) |
| `migration/` | 66 | **49** (three files: apply, rollback, staging rehearsal) | 41–47 (voice queue) exist **only here**; Step 6 production scripts (`step6*`) also here |
| Applied-migrations record | **none found in the repo**; production table UNKNOWN (U1) | | |
| `src/integrations/supabase/types.ts` | last touched 30 Sep (migration 48) | | contains some new columns; code still casts `as never` for RPCs |

Authoritative migration system: **none**. The truth is the live database plus the dated runbook notes.

## 2. Status of 41–49 (evidence)

| Migration | Production | Staging | Evidence |
|---|---|---|---|
| 41+42 transcription jobs + hardening | applied 27 Sep | applied | runbook; G01 audit shows functions/grants |
| 43 durable recovery + insert guard | applied 27 Sep | applied | G01 audit (`guard_voice_explanations_insert`) |
| 44 voice-scoring claim | applied 28 Sep (superseded by 45) | applied | runbook |
| 45 lease token | **corrected 6DD applied 28 Sep**, byte-identical (G01) | **original, unfixed** | G01 audit md5 vs script; staging audit 30 Sep |
| 46 recruiter provenance filter | **NOT applied (on hold)** | original (breaks stage69) applied | runbook; staging audit |
| 47 voice UPDATE revoke | applied 27 Sep | applied | G01 audit grants |
| 48 scratch_language | applied 30 Sep | applied | G01 audit A1–A8 |
| 49 college reports college-only | applied 1 Oct (backup first) | applied 1 Oct | EARLIER live verification |

Migration 46 remains separate and unexecuted. Its rollback script exists (`step6ee-migration-46-rollback.sql`).

## 3. Key tables (current vs legacy)

| Area | Tables | Class | RLS / notes |
|---|---|---|---|
| Accounts | auth.users (compat), account_identities, user_roles | current | role self-claim policy (F5) |
| Students | student_profiles, student_contact, student_intake, removed_students | current | RLS own/college/admin; removed_students no client access (403) |
| Colleges / companies | colleges, college_profiles, startups, startup_profiles, recruiters | current | approval gates |
| Resume | resume_claims, resume_assessments, resume_scorecards | current | |
| Learning | level_tracks, track_phases, levels, level_content, student_tracks, student_levels | current | |
| Work | tasks, lot_templates, source_content, task_rubric_config, task_sandbox_config, task_submissions | current | submissions: SELECT policy only; writes via `record_task_submission` (definer) |
| Voice | voice_explanations | current | RLS on, not forced; 4 triggers; grants broader than needed (G34) |
| Squads | seasons, squads, squad_members, squad_matches, squad/student_weekly_scores, scoring rules, name themes | current | names of teammates hidden from students (N3) |
| Engagement | xp_logs, streaks, badges, quests | current | |
| Company | task_applications, job_opportunities, recruiter_shortlists | current (0 rows) | |
| AI / ops | llm_usage, llm_cache, rate_limits, security_events, audit_logs, app_events, notifications, bug_finder_runs | current | llm_usage/rate_limits not written (F3) |
| Legacy | 12 tables + `trust_score` column (see legacy map) | HISTORICAL_KEEP_TEMPORARILY | all 0 rows |

Full per-table RLS/grant/index inventory was **not** produced: it requires production SQL (owner job). Covered
for the key tables by the 1 Oct G01 audit (`docs/closure/G01-VERIFICATION.md`).

## 4. Data-integrity notes

- Scores are written only by definer functions (`record_task_submission`, `complete_voice_scoring`), with lease and status guards (45/6DD).
- Student creation is not transactional (F19).
- The accounts sync can delete students without a ceiling (F6).
- Removed students' files are kept in storage (N2).
- The connection budget is PostgREST pool 4 × max 4 instances = 16 of 50; the other services reach the database only through PostgREST (CFG).
