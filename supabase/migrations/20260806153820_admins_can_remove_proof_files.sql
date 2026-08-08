-- Students deliberately cannot delete a proof file once submitted: destroying
-- the evidence after a reviewer has seen it is exactly what a verification
-- platform must not allow.
--
-- But that left nobody able to remove one either, so a re-submission or a
-- deleted account orphaned its file in the bucket permanently. Admins get the
-- delete, for housekeeping and for erasure requests.
CREATE POLICY "Admins can remove proof files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'proofs'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );;
