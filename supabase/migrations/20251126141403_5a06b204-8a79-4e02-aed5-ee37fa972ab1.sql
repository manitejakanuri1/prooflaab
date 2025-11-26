-- Create RPC function to get follow recommendations
CREATE OR REPLACE FUNCTION public.get_follow_recommendations()
RETURNS TABLE (
  student_id uuid,
  full_name text,
  avatar_url text,
  bio text,
  total_xp integer,
  trust_score integer,
  followers_count bigint,
  rank_score numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  current_student_id uuid;
  current_user_skills text[];
BEGIN
  -- Get current user's student_id
  SELECT id INTO current_student_id
  FROM public.student_profiles
  WHERE user_id = auth.uid()
  LIMIT 1;
  
  IF current_student_id IS NULL THEN
    RETURN;
  END IF;
  
  -- Extract current user's skills from their proof uploads
  SELECT ARRAY_AGG(DISTINCT skill)
  INTO current_user_skills
  FROM (
    SELECT UNNEST(
      string_to_array(
        COALESCE(pu.ai_summary, '') || ' ' || COALESCE(pu.submission_notes, ''),
        ' '
      )
    ) AS skill
    FROM public.proof_uploads pu
    WHERE pu.student_id = current_student_id
      AND pu.status = 'Verified'
  ) skills
  WHERE LENGTH(skill) > 3; -- Filter out very short words
  
  -- Return recommendations with ranking
  RETURN QUERY
  SELECT
    sp.id AS student_id,
    sp.full_name,
    sp.profile_photo_url AS avatar_url,
    sp.career_goals AS bio,
    COALESCE(sp.total_xp, 0) AS total_xp,
    COALESCE(sp.trust_score, 0) AS trust_score,
    COALESCE(follower_counts.count, 0) AS followers_count,
    (
      -- Skill match score (0-100 points)
      COALESCE(
        (
          SELECT COUNT(DISTINCT shared_skill) * 10
          FROM (
            SELECT UNNEST(
              string_to_array(
                COALESCE(pu.ai_summary, '') || ' ' || COALESCE(pu.submission_notes, ''),
                ' '
              )
            ) AS shared_skill
            FROM public.proof_uploads pu
            WHERE pu.student_id = sp.id
              AND pu.status = 'Verified'
          ) candidate_skills
          WHERE LENGTH(shared_skill) > 3
            AND shared_skill = ANY(current_user_skills)
        ), 0
      )
      +
      -- Follower count score (0-50 points, normalized)
      LEAST(COALESCE(follower_counts.count, 0) * 2, 50)
      +
      -- XP score (0-30 points, normalized)
      LEAST(COALESCE(sp.total_xp, 0) / 100, 30)
      +
      -- Trust score (0-20 points)
      COALESCE(sp.trust_score, 0) * 0.2
    ) AS rank_score
  FROM public.student_profiles sp
  LEFT JOIN (
    SELECT following_id, COUNT(*) as count
    FROM public.user_follows
    GROUP BY following_id
  ) follower_counts ON follower_counts.following_id = sp.user_id
  WHERE sp.id != current_student_id  -- Exclude current user
    AND sp.user_id NOT IN (  -- Exclude already followed users
      SELECT following_id
      FROM public.user_follows
      WHERE follower_id = auth.uid()
    )
    AND sp.status = 'active'
  ORDER BY rank_score DESC, followers_count DESC, sp.total_xp DESC
  LIMIT 10;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_follow_recommendations() TO authenticated;