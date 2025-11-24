-- Fix the set_proof_publicity function with correct authorization and search_path
CREATE OR REPLACE FUNCTION public.set_proof_publicity(
  p_proof_id uuid,
  p_is_public boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
declare
  owner uuid;
begin
  -- Get the student_id who owns this proof
  select student_id into owner from public.proof_uploads where id = p_proof_id;
  
  if owner is null then
    raise exception 'Proof not found';
  end if;

  -- Check if the current user owns this student profile
  if not exists (
    select 1 from public.student_profiles
    where id = owner and user_id = auth.uid()
  ) then
    raise exception 'Not authorized';
  end if;

  -- Update the proof publicity
  update public.proof_uploads
  set is_public = p_is_public
  where id = p_proof_id;

  -- Insert audit log
  insert into public.proof_public_audit (proof_upload_id, student_id, changed_by, previous, current)
  values (p_proof_id, owner, auth.uid(), not p_is_public, p_is_public);
end;
$$;