-- Fix the XP reward notification function to include title
CREATE OR REPLACE FUNCTION public.create_xp_reward_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.notifications (student_id, type, title, message, is_read, created_at)
  VALUES (
    NEW.student_id,
    'achievement',
    'XP Reward! 🎉',
    'You earned ' || NEW.xp_points || ' XP points! 🎉',
    false,
    now()
  );
  RETURN NEW;
END;
$function$;