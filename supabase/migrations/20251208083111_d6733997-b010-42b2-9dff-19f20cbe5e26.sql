-- Add reward columns to task_packs
ALTER TABLE public.task_packs 
ADD COLUMN IF NOT EXISTS reward_xp INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS reward_badge TEXT DEFAULT NULL;

-- Create student_pack_completions table if not exists
CREATE TABLE IF NOT EXISTS public.student_pack_completions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES public.task_packs(id) ON DELETE CASCADE,
  completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  badge_awarded TEXT,
  UNIQUE(student_id, pack_id)
);

-- Enable RLS
ALTER TABLE public.student_pack_completions ENABLE ROW LEVEL SECURITY;

-- RLS policies for student_pack_completions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'student_pack_completions' AND policyname = 'Students can view their own completions'
  ) THEN
    CREATE POLICY "Students can view their own completions" 
    ON public.student_pack_completions 
    FOR SELECT 
    USING (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_student_pack_completions_student ON public.student_pack_completions(student_id);
CREATE INDEX IF NOT EXISTS idx_student_pack_completions_pack ON public.student_pack_completions(pack_id);

-- Create or replace award_pack_completion function
CREATE OR REPLACE FUNCTION public.award_pack_completion(p_student_id UUID, p_pack_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pack_reward_xp INTEGER;
  pack_reward_badge TEXT;
  student_name TEXT;
BEGIN
  -- Check if already completed
  IF EXISTS (SELECT 1 FROM public.student_pack_completions WHERE student_id = p_student_id AND pack_id = p_pack_id) THEN
    RETURN FALSE;
  END IF;

  -- Get pack rewards
  SELECT reward_xp, reward_badge INTO pack_reward_xp, pack_reward_badge
  FROM public.task_packs WHERE id = p_pack_id;

  -- Record completion
  INSERT INTO public.student_pack_completions (student_id, pack_id, xp_awarded, badge_awarded)
  VALUES (p_student_id, p_pack_id, COALESCE(pack_reward_xp, 0), pack_reward_badge);

  -- Award XP
  IF pack_reward_xp > 0 THEN
    UPDATE public.student_profiles 
    SET total_xp = total_xp + pack_reward_xp
    WHERE id = p_student_id;

    INSERT INTO public.xp_logs (student_id, xp_points, source)
    VALUES (p_student_id, pack_reward_xp, 'Pack Completion');
  END IF;

  -- Create notification
  INSERT INTO public.notifications (student_id, type, title, message, is_read)
  SELECT 
    p_student_id,
    'achievement',
    'Pack Completed! 🎉',
    'Congratulations! You completed the "' || tp.name || '" pack and earned ' || COALESCE(pack_reward_xp, 0) || ' XP!',
    false
  FROM public.task_packs tp WHERE tp.id = p_pack_id;

  RETURN TRUE;
END;
$$;