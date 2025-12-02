
-- Add referrer column to existing post_engagements table
ALTER TABLE public.post_engagements 
ADD COLUMN IF NOT EXISTS referrer text;

-- Add view_count column to proof_posts (maintained by trigger)
ALTER TABLE public.proof_posts 
ADD COLUMN IF NOT EXISTS view_count integer DEFAULT 0;

-- Create function to update view count
CREATE OR REPLACE FUNCTION public.update_post_view_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.engagement_type = 'view' THEN
    UPDATE public.proof_posts
    SET view_count = (
      SELECT COUNT(*) FROM public.post_engagements 
      WHERE post_id = NEW.post_id AND engagement_type = 'view'
    )
    WHERE id = NEW.post_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger to auto-update view_count
DROP TRIGGER IF EXISTS update_view_count_trigger ON public.post_engagements;
CREATE TRIGGER update_view_count_trigger
AFTER INSERT ON public.post_engagements
FOR EACH ROW
EXECUTE FUNCTION public.update_post_view_count();

-- Initialize existing view counts
UPDATE public.proof_posts pp
SET view_count = (
  SELECT COUNT(*) FROM public.post_engagements pe 
  WHERE pe.post_id = pp.id AND pe.engagement_type = 'view'
);
