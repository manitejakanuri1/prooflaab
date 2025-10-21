-- Allow public viewing of verified proof uploads for public portfolios
CREATE POLICY "Public can view verified proofs from public portfolios"
ON proof_uploads
FOR SELECT
USING (
  status = 'Verified' 
  AND student_id IN (
    SELECT student_id 
    FROM student_portfolios 
    WHERE is_public = true
  )
);