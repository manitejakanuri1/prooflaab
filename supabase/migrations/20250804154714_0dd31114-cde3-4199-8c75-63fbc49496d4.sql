-- Create a trigger function that automatically sends onboarding emails
CREATE OR REPLACE FUNCTION public.send_onboarding_email_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_type TEXT;
BEGIN
  -- Determine user type from email or metadata
  IF NEW.email LIKE '%+student%' OR NEW.raw_user_meta_data->>'user_type' = 'student' THEN
    user_type := 'student';
  ELSIF NEW.email LIKE '%+college%' OR NEW.raw_user_meta_data->>'user_type' = 'college' THEN
    user_type := 'college';
  ELSIF NEW.email LIKE '%+startup%' OR NEW.raw_user_meta_data->>'user_type' = 'startup' THEN
    user_type := 'startup';
  ELSE
    user_type := 'general';
  END IF;

  -- Call the edge function asynchronously (fire and forget)
  PERFORM
    net.http_post(
      url := 'https://zlfjxcwltqtajnczfjjp.supabase.co/functions/v1/send-onboarding-email',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT current_setting('app.settings.service_role_key', true))
      ),
      body := jsonb_build_object(
        'email', NEW.email,
        'user_id', NEW.id,
        'user_type', user_type,
        'name', COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
      )
    );

  RETURN NEW;
END;
$$;

-- Create the trigger that fires after user insertion
CREATE TRIGGER on_auth_user_created_send_email
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.send_onboarding_email_trigger();