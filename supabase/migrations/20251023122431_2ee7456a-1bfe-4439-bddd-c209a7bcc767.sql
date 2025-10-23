-- Allow public to view college info for active recruiter links
CREATE POLICY "Public can view colleges with active recruiter links"
ON colleges
FOR SELECT
USING (
  id IN (
    SELECT college_id 
    FROM recruiter_links 
    WHERE status = 'active' 
    AND expires_at > now()
  )
);