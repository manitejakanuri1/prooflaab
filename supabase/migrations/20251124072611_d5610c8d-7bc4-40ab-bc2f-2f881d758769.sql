-- Create or replace RPC function for setting proof publicity
CREATE OR REPLACE FUNCTION public.set_proof_publicity(
  p_proof_id uuid,
  p_is_public boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  owner uuid;
begin
  select student_id into owner from public.proof_uploads where id = p_proof_id;
  if owner is null then
    raise exception 'Proof not found';
  end if;

  if owner <> auth.uid() then
    raise exception 'Not authorized';
  end if;

  update public.proof_uploads
  set is_public = p_is_public
  where id = p_proof_id;

  -- optional: insert audit
  insert into public.proof_public_audit (proof_upload_id, student_id, changed_by, previous, current)
  values (p_proof_id, owner, auth.uid(), not p_is_public, p_is_public);
end;
$$;

-- Create audit table for proof publicity changes
CREATE TABLE IF NOT EXISTS public.proof_public_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proof_upload_id uuid NOT NULL REFERENCES public.proof_uploads(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.student_profiles(id),
  changed_by uuid NOT NULL,
  previous boolean NOT NULL,
  current boolean NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on audit table
ALTER TABLE public.proof_public_audit ENABLE ROW LEVEL SECURITY;

-- Students can view their own audit logs
CREATE POLICY "Students can view their own proof publicity audit logs"
ON public.proof_public_audit
FOR SELECT
USING (
  student_id IN (
    SELECT id FROM public.student_profiles
    WHERE user_id = auth.uid()
  )
);

-- Add RLS policy for students to update their own proofs
DROP POLICY IF EXISTS "Students can update their own proof visibility" ON public.proof_uploads;
CREATE POLICY "Students can update their own proof visibility"
ON public.proof_uploads
FOR UPDATE
USING (
  student_id IN (
    SELECT id FROM public.student_profiles
    WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  student_id IN (
    SELECT id FROM public.student_profiles
    WHERE user_id = auth.uid()
  )
);