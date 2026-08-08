-- student_profiles carries two kinds of column: directory data the product is
-- built on (name, photo, branch, XP, trust score) and contact data that is
-- nobody else's business (email, resume, LinkedIn, GitHub).
--
-- Row-level security cannot tell those apart -- it decides whole rows -- so the
-- split has to be made with column privileges.
--
-- This migration closes the anonymous half, which is unambiguous: a visitor
-- with no session has no reason to read anyone's email or resume link. The
-- signed-in half is a bigger change and is deliberately left for a follow-up
-- (see note below), because profile_visibility defaults to 'private' and the
-- broad SELECT policy is currently the only thing making the feed work.

REVOKE SELECT (email, resume_url, linkedin_url, github_url)
  ON public.student_profiles FROM anon;

-- The directory columns an anonymous visitor legitimately needs for a public
-- profile page or a recruiter link.
GRANT SELECT (
  id, user_id, full_name, profile_photo_url, slug, branch, batch,
  year_of_study, total_xp, trust_score, key_interests, preferred_skills,
  career_goals, college_id, profile_visibility, status, created_at
) ON public.student_profiles TO anon;

-- NOTE for the follow-up: doing the same for `authenticated` requires moving
-- email/resume_url/linkedin_url/github_url into a separate student_contact
-- table with an own-row-only policy, because a student must still be able to
-- read their own. Six screens read those columns today: three admin, one
-- college, the followers list, and the settings page.
