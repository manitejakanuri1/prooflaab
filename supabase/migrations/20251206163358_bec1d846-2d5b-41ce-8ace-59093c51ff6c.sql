-- Drop the old get_task_pack_with_tasks function first
DROP FUNCTION IF EXISTS public.get_task_pack_with_tasks(uuid);

-- Recreate with new return type that includes due_date and xp
CREATE OR REPLACE FUNCTION public.get_task_pack_with_tasks(p_pack_id uuid)
 RETURNS TABLE(pack_id uuid, pack_name text, pack_description text, pack_difficulty text, pack_status text, pack_created_at timestamp with time zone, task_id uuid, task_title text, task_description text, task_xp integer, task_order integer, task_due_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 
    tp.id as pack_id,
    tp.name as pack_name,
    tp.description as pack_description,
    tp.difficulty as pack_difficulty,
    tp.status as pack_status,
    tp.created_at as pack_created_at,
    t.id as task_id,
    t.title as task_title,
    t.description as task_description,
    COALESCE(t.xp_reward, t.xp, 0)::INTEGER as task_xp,
    tpi.order_number as task_order,
    t.due_date::date as task_due_date
  FROM public.task_packs tp
  LEFT JOIN public.task_pack_items tpi ON tp.id = tpi.pack_id
  LEFT JOIN public.tasks t ON tpi.task_id = t.id
  WHERE tp.id = p_pack_id
    AND (
      has_role(auth.uid(), 'admin'::app_role) 
      OR tp.status = 'published'
    )
  ORDER BY tpi.order_number ASC;
$function$;