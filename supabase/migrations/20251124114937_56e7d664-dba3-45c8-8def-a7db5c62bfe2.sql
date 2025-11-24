-- Fix create_proof_post RPC to set verified_badge = true for internal verified proofs
DROP FUNCTION IF EXISTS public.create_proof_post(uuid, text, text, text, text[], text);

CREATE OR REPLACE FUNCTION public.create_proof_post(
  p_proof_id uuid,
  p_title text,
  p_description text,
  p_emoji_code text,
  p_skills text[],
  p_visibility text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  new_post_id uuid;
  v_student_id uuid;
begin
  -- Get student_id for current user
  select id into v_student_id
  from public.student_profiles
  where user_id = auth.uid();
  
  if v_student_id is null then
    raise exception 'Student profile not found for current user.';
  end if;

  -- Verify proof belongs to user AND proof is verified
  if not exists (
    select 1
    from public.proof_uploads
    where id = p_proof_id
      and student_id = v_student_id
      and status = 'Verified'
  ) then
    raise exception 'Proof does not exist, does not belong to you, or is not verified.';
  end if;

  -- Insert post with verified_badge = true for internal verified proofs
  insert into public.proof_posts (
    student_id,
    proof_id,
    title,
    description,
    emoji_code,
    skills,
    visibility,
    verified_badge
  )
  values (
    v_student_id,
    p_proof_id,
    p_title,
    p_description,
    p_emoji_code,
    p_skills,
    p_visibility,
    true  -- ✅ Set verified_badge = true for internal verified proofs
  )
  returning id into new_post_id;

  return new_post_id;
end;
$$;