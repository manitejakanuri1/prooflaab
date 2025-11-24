-- Enable RLS on proof_posts if not already enabled
ALTER TABLE public.proof_posts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view public posts" ON public.proof_posts;
DROP POLICY IF EXISTS "Users can insert their own posts" ON public.proof_posts;
DROP POLICY IF EXISTS "Users can update their own posts" ON public.proof_posts;
DROP POLICY IF EXISTS "Users can delete their own posts" ON public.proof_posts;

-- Policy 1: Allow users to view posts based on visibility settings
CREATE POLICY "Users can view public posts"
ON public.proof_posts FOR SELECT
USING (
  visibility = 'public'
  OR (
    visibility = 'college'
    AND EXISTS (
      SELECT 1 FROM public.student_profiles sp1
      JOIN public.student_profiles sp2 ON sp1.college_id = sp2.college_id
      WHERE sp1.user_id = auth.uid()
        AND sp2.id = proof_posts.student_id
        AND sp1.college_id IS NOT NULL
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.student_profiles
    WHERE id = proof_posts.student_id
      AND user_id = auth.uid()
  )
);

-- Policy 2: Allow users to insert posts for their own student profile
CREATE POLICY "Users can insert their own posts"
ON public.proof_posts FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.student_profiles
    WHERE id = student_id
      AND user_id = auth.uid()
  )
);

-- Policy 3: Allow users to update only their own posts
CREATE POLICY "Users can update their own posts"
ON public.proof_posts FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.student_profiles
    WHERE id = student_id
      AND user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.student_profiles
    WHERE id = student_id
      AND user_id = auth.uid()
  )
);

-- Policy 4: Allow users to delete only their own posts
CREATE POLICY "Users can delete their own posts"
ON public.proof_posts FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.student_profiles
    WHERE id = proof_posts.student_id
      AND user_id = auth.uid()
  )
);