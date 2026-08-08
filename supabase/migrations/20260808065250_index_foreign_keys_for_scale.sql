-- Every foreign key needs an index on its own side.
--
-- Without one, "show me this student's tasks" reads the whole tasks table, and
-- deleting a parent row scans every child table looking for references. Neither
-- is noticeable at zero rows; both are the difference between a fast page and a
-- hanging one once real students arrive.

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id                 ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by            ON public.invite_codes (created_by);
CREATE INDEX IF NOT EXISTS idx_invite_codes_used_by               ON public.invite_codes (used_by);
CREATE INDEX IF NOT EXISTS idx_notifications_student_id           ON public.notifications (student_id);
CREATE INDEX IF NOT EXISTS idx_pack_batch_assign_college_id       ON public.pack_batch_assignments (college_id);
CREATE INDEX IF NOT EXISTS idx_pack_batch_assign_pack_id          ON public.pack_batch_assignments (pack_id);
CREATE INDEX IF NOT EXISTS idx_proof_public_audit_proof_upload_id ON public.proof_public_audit (proof_upload_id);
CREATE INDEX IF NOT EXISTS idx_proof_public_audit_student_id      ON public.proof_public_audit (student_id);
CREATE INDEX IF NOT EXISTS idx_proof_uploads_reviewer_id          ON public.proof_uploads (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_proof_uploads_task_id              ON public.proof_uploads (task_id);
CREATE INDEX IF NOT EXISTS idx_recruiter_links_created_by         ON public.recruiter_links (created_by);
CREATE INDEX IF NOT EXISTS idx_resume_cert_sugg_claims_id         ON public.resume_cert_suggestions (resume_claims_id);
CREATE INDEX IF NOT EXISTS idx_resume_jd_matches_claims_id        ON public.resume_jd_matches (resume_claims_id);
CREATE INDEX IF NOT EXISTS idx_resume_scorecards_assessment_id    ON public.resume_scorecards (assessment_id);
CREATE INDEX IF NOT EXISTS idx_resume_scorecards_claims_id        ON public.resume_scorecards (resume_claims_id);
CREATE INDEX IF NOT EXISTS idx_security_events_user_id            ON public.security_events (user_id);
CREATE INDEX IF NOT EXISTS idx_student_levels_level_id            ON public.student_levels (level_id);
CREATE INDEX IF NOT EXISTS idx_student_levels_task_id             ON public.student_levels (task_id);
CREATE INDEX IF NOT EXISTS idx_student_tracks_track_slug          ON public.student_tracks (track_slug);
CREATE INDEX IF NOT EXISTS idx_task_applications_student_id       ON public.task_applications (student_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_student_id        ON public.task_assignments (student_id);
CREATE INDEX IF NOT EXISTS idx_task_packs_created_by              ON public.task_packs (created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_student_id                   ON public.tasks (student_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_created_by              ON public.user_roles (created_by);
CREATE INDEX IF NOT EXISTS idx_xp_logs_student_id                 ON public.xp_logs (student_id);
