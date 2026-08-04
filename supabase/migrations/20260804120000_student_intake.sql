-- Student intake state: drives the post-email-confirmation flow.
--
--   1.1 Welcome  (blocking, full screen, shown once)  -> has_seen_welcome
--   2.2 Choice   (upload resume | skip)               -> task_source + intake_completed_at
--
-- Deliberately a standalone table rather than columns on user_roles: user_roles
-- holds `role`, so granting a user UPDATE on their own row there would open a
-- privilege-escalation path. This table holds no privilege data, so a
-- self-service "own row" policy is safe.
--
-- Keyed by auth user_id (not student_profiles.id) because a self-signup student
-- has an auth.users row before any student_profiles row exists.

CREATE TABLE IF NOT EXISTS public.student_intake (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  has_seen_welcome boolean NOT NULL DEFAULT false,
  welcome_seen_at timestamptz,
  -- 'resume' = uploaded a resume so tasks match claimed skills
  -- 'general' = skipped, send a general task
  task_source text CHECK (task_source IN ('resume', 'general')),
  intake_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.student_intake ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own intake" ON public.student_intake;
CREATE POLICY "Users can view their own intake"
  ON public.student_intake FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can create their own intake" ON public.student_intake;
CREATE POLICY "Users can create their own intake"
  ON public.student_intake FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own intake" ON public.student_intake;
CREATE POLICY "Users can update their own intake"
  ON public.student_intake FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all intake" ON public.student_intake;
CREATE POLICY "Admins can view all intake"
  ON public.student_intake FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Existing students who already finished the old resume-onboarding flow must not
-- be dropped back into the welcome screen, so mark them done up front.
INSERT INTO public.student_intake (user_id, has_seen_welcome, welcome_seen_at, task_source, intake_completed_at)
SELECT sp.user_id, true, now(), 'resume', now()
FROM public.student_profiles sp
WHERE sp.user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.resume_scorecards rs WHERE rs.student_id = sp.id
  )
ON CONFLICT (user_id) DO NOTHING;
