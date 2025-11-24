-- Allow public read access for posts that are public or verified
DROP POLICY IF EXISTS "Public can view public posts" ON public.proof_posts;

CREATE POLICY "Public can view public posts"
ON public.proof_posts
FOR SELECT
TO public
USING (
  (visibility = 'public' AND status = 'active') 
  OR 
  (verified_badge = true AND status = 'active')
);

-- Allow public read for student profiles related to public posts
DROP POLICY IF EXISTS "Public can view student profiles for public posts" ON public.student_profiles;

CREATE POLICY "Public can view student profiles for public posts"
ON public.student_profiles
FOR SELECT
TO public
USING (
  id IN (
    SELECT student_id 
    FROM public.proof_posts 
    WHERE (visibility = 'public' AND status = 'active') 
       OR (verified_badge = true AND status = 'active')
  )
);