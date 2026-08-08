-- Ten tables that carry no load and one real risk.
--
-- The eight *_backup_* tables were snapshots taken before two student purges on
-- 4 and 5 August. The students they describe have since been deleted from the
-- product at the owner's request, but their names, emails, resume links and
-- scorecards were still sitting here. Keeping a copy of data you were asked to
-- delete is the risk; the snapshots have outlived their purpose.
--
-- `students` held a second copy of every student's name and email alongside
-- student_profiles. Four signup paths wrote it and exactly one screen read it
-- back. All five were removed in the same change as this migration, so nothing
-- reaches for it now.
--
-- `follows` was never written to by anything -- follow_user() and the whole
-- follow feature use user_follows. The two functions that still read `follows`
-- were pointed at user_follows in the previous migration.
--
-- Checked before dropping: no foreign key in the database points at any of
-- these ten, and no code path outside the ones already fixed touches them.
-- admin_users was on the earlier candidate list and is NOT dropped -- the admin
-- SystemSettings screen reads and writes it.

DROP TABLE IF EXISTS public.student_profiles_backup_20260804;
DROP TABLE IF EXISTS public.student_profiles_backup_20260805;
DROP TABLE IF EXISTS public.auth_users_backup_20260804;
DROP TABLE IF EXISTS public.auth_users_backup_20260805;
DROP TABLE IF EXISTS public.resume_claims_backup_20260804;
DROP TABLE IF EXISTS public.resume_claims_backup_20260805;
DROP TABLE IF EXISTS public.resume_scorecards_backup_20260804;
DROP TABLE IF EXISTS public.resume_scorecards_backup_20260805;

DROP TABLE IF EXISTS public.students;
DROP TABLE IF EXISTS public.follows;
