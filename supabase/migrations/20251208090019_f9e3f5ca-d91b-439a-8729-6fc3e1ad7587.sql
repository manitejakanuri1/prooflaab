-- Create table to track pack assignments to batches
CREATE TABLE public.pack_batch_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pack_id UUID NOT NULL REFERENCES public.task_packs(id) ON DELETE CASCADE,
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL,
  batch TEXT NOT NULL,
  branch TEXT,
  start_date DATE,
  due_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pack_batch_assignments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for pack_batch_assignments
CREATE POLICY "College admins can view their own pack assignments"
ON public.pack_batch_assignments
FOR SELECT
USING (
  college_id IN (
    SELECT id FROM public.colleges WHERE user_id = auth.uid()
  )
);

CREATE POLICY "College admins can insert pack assignments"
ON public.pack_batch_assignments
FOR INSERT
WITH CHECK (
  college_id IN (
    SELECT id FROM public.colleges WHERE user_id = auth.uid()
  )
);

CREATE POLICY "College admins can update their own pack assignments"
ON public.pack_batch_assignments
FOR UPDATE
USING (
  college_id IN (
    SELECT id FROM public.colleges WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Admins can manage all pack assignments"
ON public.pack_batch_assignments
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Create function to assign a pack to students in a batch
CREATE OR REPLACE FUNCTION public.assign_pack_to_batch(
  p_pack_id UUID,
  p_batch TEXT,
  p_branch TEXT DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_due_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_college_id UUID;
  v_assignment_id UUID;
  v_student RECORD;
  v_task RECORD;
  v_student_count INTEGER := 0;
  v_task_count INTEGER := 0;
BEGIN
  -- Get college ID for current user
  SELECT id INTO v_college_id
  FROM public.colleges
  WHERE user_id = auth.uid();
  
  IF v_college_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'College not found for current user');
  END IF;
  
  -- Create the batch assignment record
  INSERT INTO public.pack_batch_assignments (
    pack_id, college_id, assigned_by, batch, branch, start_date, due_date
  )
  VALUES (
    p_pack_id, v_college_id, auth.uid(), p_batch, p_branch, p_start_date, p_due_date
  )
  RETURNING id INTO v_assignment_id;
  
  -- Get all tasks in the pack
  FOR v_task IN 
    SELECT t.id, t.title, t.description, t.xp_reward, tpi.order_number
    FROM public.task_pack_items tpi
    JOIN public.tasks t ON t.id = tpi.task_id
    WHERE tpi.pack_id = p_pack_id
    ORDER BY tpi.order_number
  LOOP
    v_task_count := v_task_count + 1;
    
    -- For each student in the batch, create a task assignment
    FOR v_student IN
      SELECT id FROM public.student_profiles
      WHERE college_id = v_college_id
        AND batch = p_batch
        AND (p_branch IS NULL OR branch = p_branch)
        AND status = 'active'
    LOOP
      v_student_count := v_student_count + 1;
      
      -- Create task assignment for this student
      INSERT INTO public.task_assignments (
        task_id,
        student_id,
        status,
        assigned_at
      )
      VALUES (
        v_task.id,
        v_student.id,
        'assigned',
        now()
      )
      ON CONFLICT (task_id, student_id) DO NOTHING;
    END LOOP;
  END LOOP;
  
  -- Divide by task count to get actual student count
  IF v_task_count > 0 THEN
    v_student_count := v_student_count / v_task_count;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'assignment_id', v_assignment_id,
    'students_assigned', v_student_count,
    'tasks_in_pack', v_task_count,
    'message', 'Pack assigned successfully to ' || v_student_count || ' students'
  );
END;
$$;

-- Create function to get pack assignment summary for college
CREATE OR REPLACE FUNCTION public.get_pack_assignment_summary(p_assignment_id UUID)
RETURNS TABLE(
  pack_name TEXT,
  pack_description TEXT,
  batch TEXT,
  branch TEXT,
  total_students BIGINT,
  total_tasks BIGINT,
  completed_count BIGINT,
  average_progress NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_college_id UUID;
  v_pack_id UUID;
  v_batch TEXT;
  v_branch TEXT;
BEGIN
  -- Get college ID for current user
  SELECT c.id INTO v_college_id
  FROM public.colleges c
  WHERE c.user_id = auth.uid();
  
  -- Get assignment details
  SELECT pba.pack_id, pba.batch, pba.branch
  INTO v_pack_id, v_batch, v_branch
  FROM public.pack_batch_assignments pba
  WHERE pba.id = p_assignment_id
    AND pba.college_id = v_college_id;
  
  IF v_pack_id IS NULL THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  WITH students_in_batch AS (
    SELECT sp.id as student_id
    FROM public.student_profiles sp
    WHERE sp.college_id = v_college_id
      AND sp.batch = v_batch
      AND (v_branch IS NULL OR sp.branch = v_branch)
  ),
  tasks_in_pack AS (
    SELECT t.id as task_id
    FROM public.task_pack_items tpi
    JOIN public.tasks t ON t.id = tpi.task_id
    WHERE tpi.pack_id = v_pack_id
  ),
  student_progress AS (
    SELECT 
      s.student_id,
      COUNT(DISTINCT tip.task_id) as total_tasks,
      COUNT(DISTINCT CASE WHEN pu.status = 'Verified' THEN pu.task_id END) as completed_tasks
    FROM students_in_batch s
    CROSS JOIN tasks_in_pack tip
    LEFT JOIN public.proof_uploads pu ON pu.student_id = s.student_id AND pu.task_id = tip.task_id
    GROUP BY s.student_id
  )
  SELECT 
    tp.name::TEXT as pack_name,
    tp.description::TEXT as pack_description,
    v_batch as batch,
    v_branch as branch,
    (SELECT COUNT(*) FROM students_in_batch) as total_students,
    (SELECT COUNT(*) FROM tasks_in_pack) as total_tasks,
    COALESCE(SUM(sp.completed_tasks), 0) as completed_count,
    COALESCE(
      ROUND(
        (SUM(sp.completed_tasks)::NUMERIC / NULLIF(SUM(sp.total_tasks), 0)) * 100,
        1
      ),
      0
    ) as average_progress
  FROM public.task_packs tp
  LEFT JOIN student_progress sp ON true
  WHERE tp.id = v_pack_id
  GROUP BY tp.name, tp.description;
END;
$$;

-- Add unique constraint to task_assignments to prevent duplicates
ALTER TABLE public.task_assignments 
ADD CONSTRAINT task_assignments_unique_student_task 
UNIQUE (task_id, student_id);