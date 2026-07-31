
-- Insert a sample portfolio entry for testing
-- First, let's get a student_id from existing student_profiles (we'll use the first one available)
INSERT INTO public.student_portfolios (
  student_id,
  slug,
  bio,
  skills,
  projects,
  achievements,
  is_public,
  created_at,
  updated_at
)
SELECT 
  sp.id as student_id,
  'arjun-kumar-4587' as slug,
  'I''m a passionate frontend developer and ML enthusiast.' as bio,
  ARRAY['React', 'TailwindCSS', 'Python', 'Machine Learning'] as skills,
  '[
    {
      "title": "Build React Dashboard",
      "description": "Created an interactive student dashboard with Supabase",
      "proof_url": "https://drive.google.com/some_proof_link"
    },
    {
      "title": "ML Tutorial Completion", 
      "description": "Completed machine learning assignment and deployed model",
      "proof_url": "https://drive.google.com/ml_proof"
    }
  ]'::jsonb as projects,
  'Top 10% on Leaderboard, 85 Trust Score' as achievements,
  true as is_public,
  now() as created_at,
  now() as updated_at
FROM public.student_profiles sp
LIMIT 1
ON CONFLICT (student_id) DO UPDATE SET
  slug = EXCLUDED.slug,
  bio = EXCLUDED.bio,
  skills = EXCLUDED.skills,
  projects = EXCLUDED.projects,
  achievements = EXCLUDED.achievements,
  is_public = EXCLUDED.is_public,
  updated_at = now();

-- Also make sure the student profile has the matching slug
UPDATE public.student_profiles 
SET slug = 'arjun-kumar-4587'
WHERE id = (SELECT id FROM public.student_profiles LIMIT 1);
