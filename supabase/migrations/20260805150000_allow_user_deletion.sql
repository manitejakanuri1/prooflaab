-- Deleting a user was impossible. Seven foreign keys pointed at auth.users with
-- NO ACTION, and five more pointed at student_profiles the same way, so the
-- delete failed on the first one it hit - from SQL and from the admin screens
-- alike. Every rule below is chosen by what the row means once its owner is
-- gone, not by whatever makes the error stop.

-- Belongs to the user: goes with them.
ALTER TABLE public.student_profiles DROP CONSTRAINT IF EXISTS student_profiles_user_id_fkey;
ALTER TABLE public.student_profiles
  ADD CONSTRAINT student_profiles_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Outlives the user, because the record is about the thing, not the person.
-- An invite code that was used stays used; a task pack someone wrote stays
-- written. Only the attribution goes.
ALTER TABLE public.invite_codes DROP CONSTRAINT IF EXISTS invite_codes_used_by_fkey;
ALTER TABLE public.invite_codes
  ADD CONSTRAINT invite_codes_used_by_fkey
  FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.invite_codes DROP CONSTRAINT IF EXISTS invite_codes_created_by_fkey;
ALTER TABLE public.invite_codes
  ADD CONSTRAINT invite_codes_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.task_packs DROP CONSTRAINT IF EXISTS task_packs_created_by_fkey;
ALTER TABLE public.task_packs
  ADD CONSTRAINT task_packs_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_created_by_fkey;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- A proof survives the reviewer leaving; it does not survive its author leaving.
ALTER TABLE public.proof_uploads DROP CONSTRAINT IF EXISTS proof_uploads_reviewer_id_fkey;
ALTER TABLE public.proof_uploads
  ADD CONSTRAINT proof_uploads_reviewer_id_fkey
  FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- created_by is NOT NULL here, so there is no detached state to leave it in.
-- A share link with no owner cannot be managed or revoked by anyone.
ALTER TABLE public.recruiter_links DROP CONSTRAINT IF EXISTS recruiter_links_created_by_fkey;
ALTER TABLE public.recruiter_links
  ADD CONSTRAINT recruiter_links_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Everything a student accumulates goes when the student does.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_student_id_fkey;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.proof_public_audit DROP CONSTRAINT IF EXISTS proof_public_audit_student_id_fkey;
ALTER TABLE public.proof_public_audit
  ADD CONSTRAINT proof_public_audit_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.proof_uploads DROP CONSTRAINT IF EXISTS proof_uploads_student_id_fkey;
ALTER TABLE public.proof_uploads
  ADD CONSTRAINT proof_uploads_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_student_id_fkey;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;

ALTER TABLE public.xp_logs DROP CONSTRAINT IF EXISTS xp_logs_student_id_fkey;
ALTER TABLE public.xp_logs
  ADD CONSTRAINT xp_logs_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.student_profiles(id) ON DELETE CASCADE;
