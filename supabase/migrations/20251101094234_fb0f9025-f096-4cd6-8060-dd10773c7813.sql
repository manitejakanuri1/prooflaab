-- Update the update_student_scores trigger to also update task_assignments status
CREATE OR REPLACE FUNCTION public.update_student_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    task_xp INTEGER;
BEGIN
    -- Only process when status changes to 'Verified'
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'Verified' THEN
        -- Get XP from the task
        SELECT COALESCE(xp_reward, xp, 0) INTO task_xp 
        FROM public.tasks 
        WHERE id = NEW.task_id;
        
        -- Update student's total XP and trust score
        UPDATE public.student_profiles 
        SET 
            total_xp = total_xp + task_xp,
            trust_score = LEAST(trust_score + 10, 100),
            updated_at = now()
        WHERE id = NEW.student_id;
        
        -- Log the XP gain
        INSERT INTO public.xp_logs (student_id, xp_points, source, created_at)
        VALUES (NEW.student_id, task_xp, 'Task Verification', now());
        
        -- Update trust score table
        INSERT INTO public.trust_scores (student_id, score, last_updated)
        VALUES (NEW.student_id, (SELECT trust_score FROM public.student_profiles WHERE id = NEW.student_id), now())
        ON CONFLICT (student_id) 
        DO UPDATE SET 
            score = (SELECT trust_score FROM public.student_profiles WHERE id = NEW.student_id),
            last_updated = now();
            
        -- Mark task as completed in tasks table
        UPDATE public.tasks 
        SET 
            status = 'Completed',
            completed_at = now(),
            updated_at = now()
        WHERE id = NEW.task_id;
        
        -- Mark task assignment as completed in task_assignments table
        UPDATE public.task_assignments
        SET
            status = 'completed',
            completed_at = now(),
            updated_at = now()
        WHERE task_id = NEW.task_id AND student_id = NEW.student_id;
    END IF;
    
    RETURN NEW;
END;
$function$;