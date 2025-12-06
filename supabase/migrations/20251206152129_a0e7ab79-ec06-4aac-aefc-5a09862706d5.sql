-- Create task_type enum for tasks
DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_type') THEN
    CREATE TYPE task_type AS ENUM ('assigned', 'custom', 'startup', 'pack');
  END IF;
END $$;

-- Create task_packs table
CREATE TABLE IF NOT EXISTS public.task_packs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  difficulty TEXT NOT NULL DEFAULT 'Beginner' CHECK (difficulty IN ('Beginner', 'Intermediate', 'Advanced')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create task_pack_items table (links packs to tasks)
CREATE TABLE IF NOT EXISTS public.task_pack_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES public.task_packs(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  order_number INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(pack_id, task_id)
);

-- Add pack_id column to tasks table (nullable, backward compatible)
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS pack_id UUID REFERENCES public.task_packs(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_task_pack_items_pack_id ON public.task_pack_items(pack_id);
CREATE INDEX IF NOT EXISTS idx_task_pack_items_task_id ON public.task_pack_items(task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_pack_id ON public.tasks(pack_id);

-- Enable RLS on task_packs
ALTER TABLE public.task_packs ENABLE ROW LEVEL SECURITY;

-- Enable RLS on task_pack_items
ALTER TABLE public.task_pack_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for task_packs

-- Admins can manage all packs
CREATE POLICY "Admins can manage task packs"
ON public.task_packs
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Students can view published packs
CREATE POLICY "Students can view published packs"
ON public.task_packs
FOR SELECT
USING (status = 'published' AND has_role(auth.uid(), 'student'::app_role));

-- College admins can view published packs
CREATE POLICY "College admins can view published packs"
ON public.task_packs
FOR SELECT
USING (status = 'published' AND has_role(auth.uid(), 'college_admin'::app_role));

-- RLS Policies for task_pack_items

-- Admins can manage all pack items
CREATE POLICY "Admins can manage task pack items"
ON public.task_pack_items
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Students can view items from published packs
CREATE POLICY "Students can view published pack items"
ON public.task_pack_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.task_packs 
    WHERE id = pack_id AND status = 'published'
  ) 
  AND has_role(auth.uid(), 'student'::app_role)
);

-- College admins can view items from published packs
CREATE POLICY "College admins can view published pack items"
ON public.task_pack_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.task_packs 
    WHERE id = pack_id AND status = 'published'
  ) 
  AND has_role(auth.uid(), 'college_admin'::app_role)
);

-- Create trigger for updated_at on task_packs
CREATE TRIGGER update_task_packs_updated_at
  BEFORE UPDATE ON public.task_packs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger for updated_at on task_pack_items
CREATE TRIGGER update_task_pack_items_updated_at
  BEFORE UPDATE ON public.task_pack_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RPC function to get all task packs (with task count)
CREATE OR REPLACE FUNCTION public.get_task_packs(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  difficulty TEXT,
  status TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  task_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    tp.id,
    tp.name,
    tp.description,
    tp.difficulty,
    tp.status,
    tp.created_by,
    tp.created_at,
    tp.updated_at,
    COUNT(tpi.id) as task_count
  FROM public.task_packs tp
  LEFT JOIN public.task_pack_items tpi ON tp.id = tpi.pack_id
  WHERE (p_status IS NULL OR tp.status = p_status)
    AND (
      has_role(auth.uid(), 'admin'::app_role) 
      OR tp.status = 'published'
    )
  GROUP BY tp.id
  ORDER BY tp.created_at DESC;
$$;

-- RPC function to get a single task pack with its tasks
CREATE OR REPLACE FUNCTION public.get_task_pack_with_tasks(p_pack_id UUID)
RETURNS TABLE (
  pack_id UUID,
  pack_name TEXT,
  pack_description TEXT,
  pack_difficulty TEXT,
  pack_status TEXT,
  pack_created_at TIMESTAMPTZ,
  task_id UUID,
  task_title TEXT,
  task_description TEXT,
  task_xp INTEGER,
  task_order INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
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
    tpi.order_number as task_order
  FROM public.task_packs tp
  LEFT JOIN public.task_pack_items tpi ON tp.id = tpi.pack_id
  LEFT JOIN public.tasks t ON tpi.task_id = t.id
  WHERE tp.id = p_pack_id
    AND (
      has_role(auth.uid(), 'admin'::app_role) 
      OR tp.status = 'published'
    )
  ORDER BY tpi.order_number ASC;
$$;

-- RPC function to create a task pack with tasks
CREATE OR REPLACE FUNCTION public.create_task_pack(
  p_name TEXT,
  p_description TEXT,
  p_difficulty TEXT,
  p_status TEXT,
  p_tasks JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  new_pack_id UUID;
  task_item JSONB;
  new_task_id UUID;
  task_order INTEGER := 1;
BEGIN
  -- Only admins can create packs
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can create task packs';
  END IF;

  -- Create the pack
  INSERT INTO public.task_packs (name, description, difficulty, status, created_by)
  VALUES (p_name, p_description, p_difficulty, p_status, auth.uid())
  RETURNING id INTO new_pack_id;

  -- Create tasks and link them to the pack
  FOR task_item IN SELECT * FROM jsonb_array_elements(p_tasks)
  LOOP
    -- Create a new task for this pack item
    INSERT INTO public.tasks (
      title, 
      description, 
      due_date,
      xp_reward,
      status,
      visibility,
      created_by_admin_id,
      pack_id,
      source
    )
    VALUES (
      task_item->>'title',
      task_item->>'description',
      (now() + interval '1 year')::date, -- Default due date 1 year from now
      COALESCE((task_item->>'xp')::INTEGER, 100),
      'In Progress',
      'public',
      auth.uid(),
      new_pack_id,
      'pack'
    )
    RETURNING id INTO new_task_id;

    -- Link task to pack with order
    INSERT INTO public.task_pack_items (pack_id, task_id, order_number)
    VALUES (new_pack_id, new_task_id, task_order);

    task_order := task_order + 1;
  END LOOP;

  RETURN new_pack_id;
END;
$$;

-- RPC function to update a task pack
CREATE OR REPLACE FUNCTION public.update_task_pack(
  p_pack_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_difficulty TEXT,
  p_status TEXT,
  p_tasks JSONB DEFAULT '[]'::JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  task_item JSONB;
  new_task_id UUID;
  existing_task_id UUID;
  task_order INTEGER := 1;
BEGIN
  -- Only admins can update packs
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can update task packs';
  END IF;

  -- Update the pack
  UPDATE public.task_packs
  SET 
    name = p_name,
    description = p_description,
    difficulty = p_difficulty,
    status = p_status,
    updated_at = now()
  WHERE id = p_pack_id;

  -- Remove existing task links (but keep the tasks)
  DELETE FROM public.task_pack_items WHERE pack_id = p_pack_id;

  -- Re-create task links with new order
  FOR task_item IN SELECT * FROM jsonb_array_elements(p_tasks)
  LOOP
    existing_task_id := (task_item->>'id')::UUID;
    
    IF existing_task_id IS NOT NULL THEN
      -- Update existing task
      UPDATE public.tasks
      SET 
        title = task_item->>'title',
        description = task_item->>'description',
        updated_at = now()
      WHERE id = existing_task_id;

      -- Re-link to pack
      INSERT INTO public.task_pack_items (pack_id, task_id, order_number)
      VALUES (p_pack_id, existing_task_id, task_order);
    ELSE
      -- Create new task
      INSERT INTO public.tasks (
        title, 
        description, 
        due_date,
        xp_reward,
        status,
        visibility,
        created_by_admin_id,
        pack_id,
        source
      )
      VALUES (
        task_item->>'title',
        task_item->>'description',
        (now() + interval '1 year')::date,
        COALESCE((task_item->>'xp')::INTEGER, 100),
        'In Progress',
        'public',
        auth.uid(),
        p_pack_id,
        'pack'
      )
      RETURNING id INTO new_task_id;

      -- Link new task to pack
      INSERT INTO public.task_pack_items (pack_id, task_id, order_number)
      VALUES (p_pack_id, new_task_id, task_order);
    END IF;

    task_order := task_order + 1;
  END LOOP;

  RETURN TRUE;
END;
$$;

-- RPC function to delete a task pack
CREATE OR REPLACE FUNCTION public.delete_task_pack(p_pack_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Only admins can delete packs
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can delete task packs';
  END IF;

  -- Delete the pack (cascade will handle task_pack_items)
  DELETE FROM public.task_packs WHERE id = p_pack_id;

  RETURN TRUE;
END;
$$;