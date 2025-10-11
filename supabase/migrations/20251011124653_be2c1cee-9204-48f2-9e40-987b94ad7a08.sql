-- Fix validate_task trigger to only check due_date on INSERT or when due_date changes
CREATE OR REPLACE FUNCTION public.validate_task()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
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