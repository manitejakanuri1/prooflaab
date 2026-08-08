-- Regression from the contact split.
--
-- 20260808102950 moved email off student_profiles into student_contact, but
-- validate_student_profile() still read NEW.email. A trigger referencing a
-- dropped column does not fail at migration time -- it fails on the next
-- INSERT, with "record new has no field email". So every student profile
-- created after that migration threw, which meant new students got an auth
-- account and no profile, and resume-parser answered "Student profile not
-- found" for them.
--
-- The email check goes away rather than moving: the address now comes from
-- auth.users via the create_student_contact_row trigger, and Supabase Auth has
-- already validated it. Re-checking a value the user cannot set here was
-- always theatre.
--
-- Checked at the same time: no other function or view in the schema still
-- reads email, resume_url, linkedin_url or github_url off student_profiles.

CREATE OR REPLACE FUNCTION public.validate_student_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
    -- Full name is still worth checking: this one the user does type.
    IF length(trim(NEW.full_name)) < 2 OR length(trim(NEW.full_name)) > 100 THEN
        RAISE EXCEPTION 'Full name must be between 2 and 100 characters';
    END IF;

    RETURN NEW;
END;
$function$;
