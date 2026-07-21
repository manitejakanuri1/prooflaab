-- Create proof_posts table for social feed
CREATE TABLE IF NOT EXISTS public.proof_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  proof_id uuid NOT NULL REFERENCES public.proof_uploads(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  emoji_code text NOT NULL,
  skills text[] DEFAULT '{}',
  visibility text NOT NULL CHECK (visibility IN ('public', 'college', 'private')) DEFAULT 'public',
  likes_count integer DEFAULT 0,
  comments_count integer DEFAULT 0,
  verified_badge boolean DEFAULT false,
  status text DEFAULT 'active' CHECK (status IN ('active', 'pending_moderation', 'revoked')),
  created_at timestamp with time zone DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_proof_posts_student_id ON public.proof_posts(student_id);
CREATE INDEX IF NOT EXISTS idx_proof_posts_proof_id ON public.proof_posts(proof_id);
CREATE INDEX IF NOT EXISTS idx_proof_posts_created_at ON public.proof_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proof_posts_visibility ON public.proof_posts(visibility);

-- Security definer function to check if a user owns a student profile
CREATE OR REPLACE FUNCTION public.is_student_owner(_student_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_profiles
    WHERE id = _student_id
      AND user_id = _user_id
  );
$$;

-- Security definer function to check if two students are in the same college
CREATE OR REPLACE FUNCTION public.same_college(_student_id_1 uuid, _student_id_2 uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_profiles sp1
    INNER JOIN public.student_profiles sp2 ON sp1.college_id = sp2.college_id
    WHERE sp1.id = _student_id_1
      AND sp2.id = _student_id_2
      AND sp1.college_id IS NOT NULL
  );
$$;

-- Security definer function to get current user's student profile id
CREATE OR REPLACE FUNCTION public.get_current_student_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.student_profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Enable RLS
ALTER TABLE public.proof_posts ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow INSERT only for own student profile
CREATE POLICY "Students can insert their own posts"
ON public.proof_posts
FOR INSERT
TO authenticated
WITH CHECK (public.is_student_owner(student_id, auth.uid()));

-- RLS Policy: Allow SELECT based on visibility rules
CREATE POLICY "Users can view posts based on visibility"
ON public.proof_posts
FOR SELECT
TO authenticated
USING (
  visibility = 'public'
  OR (visibility = 'college' AND public.same_college(student_id, public.get_current_student_id()))
  OR public.is_student_owner(student_id, auth.uid())
);

-- RLS Policy: Allow UPDATE only for own posts and limited fields
CREATE POLICY "Students can update their own posts"
ON public.proof_posts
FOR UPDATE
TO authenticated
USING (public.is_student_owner(student_id, auth.uid()))
WITH CHECK (public.is_student_owner(student_id, auth.uid()));

-- No DELETE policy (use status='revoked' instead)