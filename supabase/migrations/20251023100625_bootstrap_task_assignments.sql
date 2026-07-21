-- Bootstrap: table created outside migration history in the original project.
CREATE TABLE IF NOT EXISTS public.task_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  status text DEFAULT 'assigned'::text CHECK (status = ANY (ARRAY['assigned'::text, 'in_progress'::text, 'submitted'::text, 'reviewed'::text, 'completed'::text, 'rejected'::text])),
  assigned_at timestamp without time zone DEFAULT now(),
  completed_at timestamp without time zone,
  submitted_at timestamp without time zone,
  review_status text CHECK (review_status = ANY (ARRAY['under_review'::text, 'verified'::text, 'rejected'::text])),
  reviewed_by uuid,
  feedback text,
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT task_assignments_pkey PRIMARY KEY (id)
);

ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;
