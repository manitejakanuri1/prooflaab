-- Add external_link column to proof_posts table for unverified external projects
ALTER TABLE public.proof_posts 
ADD COLUMN IF NOT EXISTS external_link TEXT;

-- Add a comment to document the column
COMMENT ON COLUMN public.proof_posts.external_link IS 'External project URL for unverified posts (GitHub, YouTube, etc.)';