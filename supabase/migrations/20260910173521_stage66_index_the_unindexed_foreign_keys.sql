-- NOTE ON THE FILE NAME: version 20260910173521, as recorded by apply_migration.
--
-- Twenty-one foreign keys had no covering index.
--
-- Postgres does not create one for the referencing side of a foreign key. Every
-- delete or update on the parent then has to scan the whole child table to
-- check the constraint, and every join across that key does the same. At the
-- current row counts none of this is measurable; the point is that it stops
-- being free the moment a college imports its students.
--
-- IF NOT EXISTS throughout, so this is safe to re-run.
create index if not exists announcements_created_by_admin_idx on public.announcements (created_by_admin);
create index if not exists badges_track_slug_idx on public.badges (track_slug);
create index if not exists interventions_created_by_idx on public.interventions (created_by);
create index if not exists learning_resources_created_by_idx on public.learning_resources (created_by);
create index if not exists llm_usage_user_id_idx on public.llm_usage (user_id);
create index if not exists manual_adjustment_log_admin_id_idx on public.manual_adjustment_log (admin_id);
create index if not exists recruiters_verified_by_idx on public.recruiters (verified_by);
create index if not exists seasons_champion_squad_id_idx on public.seasons (champion_squad_id);
create index if not exists seasons_runner_up_squad_id_idx on public.seasons (runner_up_squad_id);
create index if not exists seasons_third_squad_id_idx on public.seasons (third_squad_id);
create index if not exists security_events_user_id_idx on public.security_events (user_id);
create index if not exists source_content_submitted_by_college_id_idx on public.source_content (submitted_by_college_id);
create index if not exists squad_members_assigned_by_idx on public.squad_members (assigned_by);
create index if not exists squad_weekly_scores_squad_id_idx on public.squad_weekly_scores (squad_id);
create index if not exists student_badges_badge_slug_idx on public.student_badges (badge_slug);
create index if not exists student_import_rows_student_id_idx on public.student_import_rows (student_id);
create index if not exists student_imports_uploaded_by_idx on public.student_imports (uploaded_by);
create index if not exists student_quests_quest_slug_idx on public.student_quests (quest_slug);
create index if not exists student_tracks_track_slug_idx on public.student_tracks (track_slug);
create index if not exists student_week_plan_level_id_idx on public.student_week_plan (level_id);
create index if not exists task_templates_created_by_idx on public.task_templates (created_by);
