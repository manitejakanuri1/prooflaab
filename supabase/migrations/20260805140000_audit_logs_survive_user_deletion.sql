-- audit_logs.user_id referenced auth.users with NO ACTION, so any attempt to
-- delete a user failed on this constraint - including from the admin screens.
-- The row is not the problem; the rule is.
--
-- SET NULL rather than CASCADE: an audit log exists to outlive the thing it
-- describes. Cascading would quietly erase the record of what an account did at
-- the exact moment someone deleted that account, which is the one time the
-- record matters most. user_id is already nullable, so the history survives with
-- the actor detached.

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
