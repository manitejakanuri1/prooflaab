-- Drop the old restrictive policy
DROP POLICY IF EXISTS "Public can view verified proofs from public portfolios" ON public.proof_uploads;

-- Create new policy allowing public viewing of individual public proofs
CREATE POLICY "Public can view individual public verified proofs"
ON public.proof_uploads
FOR SELECT
TO public
USING (
  status = 'Verified' 
  AND is_public = true
);