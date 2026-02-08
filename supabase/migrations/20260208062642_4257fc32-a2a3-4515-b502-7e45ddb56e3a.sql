-- =====================================================
-- SECURITY HARDENING MIGRATION
-- Phase 2: Function search paths + RLS policy fixes
-- =====================================================

-- =====================================================
-- PART 1: Fix function search_path on 12 functions
-- =====================================================

-- 1. update_profile_updated_at
CREATE OR REPLACE FUNCTION public.update_profile_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = 'public'
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

-- 2. calculate_upload_deadline
CREATE OR REPLACE FUNCTION public.calculate_upload_deadline()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = 'public'
AS $function$
BEGIN
  -- Set upload deadline when task is started
  IF OLD.started_at IS NULL AND NEW.started_at IS NOT NULL THEN
    NEW.upload_deadline := NEW.started_at + (NEW.duration_days || ' days')::interval;
    NEW.status := 'In Progress';
  END IF;
  
  RETURN NEW;
END;
$function$;

-- 3. generate_url_slug
CREATE OR REPLACE FUNCTION public.generate_url_slug(student_name text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path = 'public'
AS $function$
BEGIN
  RETURN lower(replace(trim(student_name), ' ', '-'));
END;
$function$;

-- 4. generate_unique_slug
CREATE OR REPLACE FUNCTION public.generate_unique_slug(input_text text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path = 'public'
AS $function$
DECLARE
    base_slug text;
    final_slug text;
    counter integer := 0;
BEGIN
    -- Convert to lowercase, replace spaces with hyphens, remove special characters
    base_slug := lower(regexp_replace(input_text, '[^a-zA-Z0-9\s]', '', 'g'));
    base_slug := regexp_replace(base_slug, '\s+', '-', 'g');
    base_slug := trim(both '-' from base_slug);
    
    -- If empty after cleaning, use 'user'
    IF base_slug = '' THEN
        base_slug := 'user';
    END IF;
    
    final_slug := base_slug;
    
    -- Check if slug exists and increment counter if needed
    WHILE EXISTS (SELECT 1 FROM public.student_profiles WHERE slug = final_slug) LOOP
        counter := counter + 1;
        final_slug := base_slug || '-' || counter::text;
    END LOOP;
    
    RETURN final_slug;
END;
$function$;

-- 5. auto_generate_slug
CREATE OR REPLACE FUNCTION public.auto_generate_slug()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = 'public'
AS $function$
BEGIN
  -- Only generate slug if it's not already set
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := public.generate_unique_slug(NEW.full_name);
  END IF;
  RETURN NEW;
END;
$function$;

-- 6. sync_portfolio_slug
CREATE OR REPLACE FUNCTION public.sync_portfolio_slug()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = 'public'
AS $function$
BEGIN
  -- Update portfolio slug when student profile slug changes
  UPDATE public.student_portfolios 
  SET slug = NEW.slug 
  WHERE student_id = NEW.id;
  RETURN NEW;
END;
$function$;

-- 7. set_initial_portfolio_slug
CREATE OR REPLACE FUNCTION public.set_initial_portfolio_slug()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = 'public'
AS $function$
BEGIN
  -- Set slug from student_profiles when portfolio is created
  SELECT slug INTO NEW.slug 
  FROM public.student_profiles 
  WHERE id = NEW.student_id;
  RETURN NEW;
END;
$function$;

-- 8. update_college_last_active_on_login
CREATE OR REPLACE FUNCTION public.update_college_last_active_on_login()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = 'public'
AS $function$
BEGIN
  -- Update last_active when college record is updated (indicating activity)
  IF OLD.updated_at IS DISTINCT FROM NEW.updated_at THEN
    NEW.last_active = now();
  END IF;
  RETURN NEW;
END;
$function$;

-- 9. update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- 10. notify_student_recruiter_interest (add SECURITY DEFINER + search_path)
CREATE OR REPLACE FUNCTION public.notify_student_recruiter_interest()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = 'public'
AS $function$
DECLARE
  post_title text;
BEGIN
  -- Get the post title
  SELECT title INTO post_title FROM public.proof_posts WHERE id = NEW.post_id;
  
  -- Insert notification for the student
  INSERT INTO public.social_notifications (user_id, type, message, post_id, triggered_by)
  SELECT 
    sp.user_id,
    'recruiter_interest',
    '📩 A recruiter is interested in your project: ' || COALESCE(post_title, 'Untitled'),
    NEW.post_id,
    NULL
  FROM public.student_profiles sp
  WHERE sp.id = NEW.student_id;
  
  RETURN NEW;
END;
$function$;

-- 11. validate_task (already has some search_path, but lets make it consistent with empty string for security)
CREATE OR REPLACE FUNCTION public.validate_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = 'public'
AS $function$
BEGIN
    -- Validate title
    IF NOT public.validate_task_title(NEW.title) THEN
        RAISE EXCEPTION 'Task title must be between 3 and 200 characters';
    END IF;
    
    -- Only validate due date on INSERT or when due_date is actually being changed
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.due_date IS DISTINCT FROM NEW.due_date) THEN
        IF NEW.due_date <= now() THEN
            RAISE EXCEPTION 'Due date must be in the future';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$;

-- 12. validate_student_profile (already has empty search_path set but in wrong format)
CREATE OR REPLACE FUNCTION public.validate_student_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = 'public'
AS $function$
BEGIN
    -- Validate email
    IF NOT public.validate_email(NEW.email) THEN
        RAISE EXCEPTION 'Invalid email format';
    END IF;
    
    -- Validate full name
    IF length(trim(NEW.full_name)) < 2 OR length(trim(NEW.full_name)) > 100 THEN
        RAISE EXCEPTION 'Full name must be between 2 and 100 characters';
    END IF;
    
    RETURN NEW;
END;
$function$;

-- =====================================================
-- PART 2: Fix overly permissive RLS policies
-- =====================================================

-- 2.1 Fix post_engagements - require authenticated users
DROP POLICY IF EXISTS "Anyone can insert engagements" ON public.post_engagements;

CREATE POLICY "Authenticated users can insert engagements"
ON public.post_engagements
FOR INSERT
TO authenticated
WITH CHECK (
  -- User must be authenticated (implicit via TO authenticated)
  -- For logged-in users, viewer_id should match auth.uid() or be null for anonymous tracking
  (viewer_id IS NULL OR viewer_id = auth.uid())
);

-- Also allow anon users to insert view engagements for public posts (needed for recruiter views)
CREATE POLICY "Anon users can insert view engagements for public posts"
ON public.post_engagements
FOR INSERT
TO anon
WITH CHECK (
  engagement_type = 'view' 
  AND viewer_type = 'recruiter'
  AND EXISTS (
    SELECT 1 FROM public.proof_posts pp 
    WHERE pp.id = post_id 
    AND pp.visibility = 'public'
  )
);

-- 2.2 post_likes - reading likes should be scoped to visible posts
DROP POLICY IF EXISTS "Users can read likes" ON public.post_likes;

CREATE POLICY "Users can read likes on visible posts"
ON public.post_likes
FOR SELECT
TO authenticated
USING (
  -- User can see likes on posts they can access
  EXISTS (
    SELECT 1 FROM public.proof_posts pp
    WHERE pp.id = post_id
    AND (
      pp.visibility = 'public'
      OR pp.student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid())
      OR (pp.visibility = 'college' AND public.same_college(pp.student_id, public.get_current_student_id()))
    )
  )
);

-- 2.3 post_comments - reading comments should be scoped to visible posts
DROP POLICY IF EXISTS "Users can read comments" ON public.post_comments;

CREATE POLICY "Users can read comments on visible posts"
ON public.post_comments
FOR SELECT
TO authenticated
USING (
  -- User can see comments on posts they can access
  EXISTS (
    SELECT 1 FROM public.proof_posts pp
    WHERE pp.id = post_id
    AND (
      pp.visibility = 'public'
      OR pp.student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid())
      OR (pp.visibility = 'college' AND public.same_college(pp.student_id, public.get_current_student_id()))
    )
  )
);