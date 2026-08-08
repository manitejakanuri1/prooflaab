-- The admin student-management screen creates and edits student records,
-- which includes the email address. The own-row-only write rules locked
-- admins out of the table they are supposed to administer.
--
-- Read access already allowed admins; writes now match.

ALTER POLICY "Create your own contact row"
  ON public.student_contact
  WITH CHECK (
    student_id IN (
      SELECT id FROM public.student_profiles WHERE user_id = (SELECT auth.uid())
    )
    OR public.is_admin()
  );

ALTER POLICY "Edit your own contact details"
  ON public.student_contact
  USING (
    student_id IN (
      SELECT id FROM public.student_profiles WHERE user_id = (SELECT auth.uid())
    )
    OR public.is_admin()
  )
  WITH CHECK (
    student_id IN (
      SELECT id FROM public.student_profiles WHERE user_id = (SELECT auth.uid())
    )
    OR public.is_admin()
  );
