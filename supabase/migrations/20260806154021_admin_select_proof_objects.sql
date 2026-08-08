-- Deleting an object requires being able to see it first, so the delete policy
-- alone did nothing — Storage could not resolve the row to remove.
--
-- No new exposure: proof-file-url already signs any proof for an admin, so this
-- grants them nothing they could not already reach, it just lets the housekeeping
-- delete actually run.
CREATE POLICY "Admins can read proof files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'proofs'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );;
