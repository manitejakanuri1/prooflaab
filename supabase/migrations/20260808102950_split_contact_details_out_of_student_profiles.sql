-- The last big hole: any signed-in account could read every student's email.
--
-- student_profiles is read broadly on purpose. The feed, the followers list,
-- the leaderboard and the suggestion rail all need to see other students, so
-- the policy for signed-in users is USING (true). That is correct for a
-- directory -- name, photo, branch, XP -- and wrong for an email address,
-- which sat in the same row.
--
-- Row-level security decides whole rows, so the only real fix is to put the
-- contact details in their own table with their own rule. Anyone signed in can
-- still see who you are; only you, an admin, and your own college can see how
-- to reach you.
--
-- resume_url, linkedin_url and github_url move too. Nothing in the app writes
-- them today and every row is null, but the recruiter contact card reads them,
-- so they get a home rather than a deletion.

CREATE TABLE public.student_contact (
  student_id   uuid PRIMARY KEY REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  email        text,
  resume_url   text,
  linkedin_url text,
  github_url   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.student_contact (student_id, email, resume_url, linkedin_url, github_url)
SELECT id, email, resume_url, linkedin_url, github_url
FROM public.student_profiles;

ALTER TABLE public.student_contact ENABLE ROW LEVEL SECURITY;

-- Three people have a reason to see a student's contact details: the student,
-- an admin, and the college that student belongs to.
CREATE POLICY "Read contact details you are entitled to"
  ON public.student_contact FOR SELECT
  USING (
    student_id IN (
      SELECT id FROM public.student_profiles WHERE user_id = (SELECT auth.uid())
    )
    OR public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.student_profiles sp
      JOIN public.colleges c ON c.id = sp.college_id
      WHERE sp.id = student_contact.student_id
        AND c.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Edit your own contact details"
  ON public.student_contact FOR UPDATE
  USING (
    student_id IN (
      SELECT id FROM public.student_profiles WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    student_id IN (
      SELECT id FROM public.student_profiles WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Create your own contact row"
  ON public.student_contact FOR INSERT
  WITH CHECK (
    student_id IN (
      SELECT id FROM public.student_profiles WHERE user_id = (SELECT auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.student_contact TO authenticated;

CREATE INDEX idx_student_contact_email ON public.student_contact (lower(email));

-- A public proof post carries a "get in touch" card. That is the one place
-- contact details are meant to travel further than the rule above allows, and
-- only because the student chose to make their profile public. The check lives
-- in here rather than in a policy so an anonymous recruiter can use it too.
CREATE OR REPLACE FUNCTION public.get_public_contact(p_student_id uuid)
RETURNS TABLE(email text, resume_url text, linkedin_url text, github_url text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT sc.email, sc.resume_url, sc.linkedin_url, sc.github_url
  FROM public.student_contact sc
  JOIN public.student_profiles sp ON sp.id = sc.student_id
  WHERE sc.student_id = p_student_id
    AND sp.profile_visibility = 'public';
$function$;

REVOKE ALL ON FUNCTION public.get_public_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_contact(uuid) TO anon, authenticated;

-- The admin spend view reached into student_profiles for the email. It now
-- reads the contact table, and because it is a security_invoker view the rule
-- above still applies -- an admin sees every row, a student sees only theirs.
DROP VIEW IF EXISTS public.llm_usage_by_student;

CREATE VIEW public.llm_usage_by_student
WITH (security_invoker = on) AS
  SELECT u.student_id,
         sc.email,
         sp.full_name,
         u.feature,
         u.provider,
         count(*)                    AS calls,
         sum(u.prompt_tokens)        AS prompt_tokens,
         sum(u.completion_tokens)    AS completion_tokens,
         sum(u.total_tokens)         AS total_tokens,
         max(u.created_at)           AS last_used
  FROM llm_usage u
  LEFT JOIN student_profiles sp ON sp.id = u.student_id
  LEFT JOIN student_contact  sc ON sc.student_id = u.student_id
  GROUP BY u.student_id, sc.email, sp.full_name, u.feature, u.provider;

REVOKE ALL ON public.llm_usage_by_student FROM anon;
GRANT SELECT ON public.llm_usage_by_student TO authenticated;

-- Now the columns can go. While they exist, the broad directory policy keeps
-- handing them out.
ALTER TABLE public.student_profiles
  DROP COLUMN email,
  DROP COLUMN resume_url,
  DROP COLUMN linkedin_url,
  DROP COLUMN github_url;

-- Keep a contact row in step with its profile. The email comes from the auth
-- account, which is where it was always really coming from.
CREATE OR REPLACE FUNCTION public.create_student_contact_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.student_contact (student_id, email)
  SELECT NEW.id, u.email
  FROM auth.users u
  WHERE u.id = NEW.user_id
  ON CONFLICT (student_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_student_profile_contact
  AFTER INSERT ON public.student_profiles
  FOR EACH ROW EXECUTE FUNCTION public.create_student_contact_row();

REVOKE ALL ON FUNCTION public.create_student_contact_row() FROM PUBLIC;
