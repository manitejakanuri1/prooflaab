-- =======================================
-- RPC 1: Create a new proof feed post
-- =======================================

create or replace function public.create_proof_post(
  p_proof_id uuid,
  p_title text,
  p_description text,
  p_emoji_code text,
  p_skills text[],
  p_visibility text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  insert into public.proof_posts (
    student_id,
    proof_id,
    title,
    description,
    emoji_code,
    skills,
    visibility
  )
  values (
    v_student_id,
    p_proof_id,
    p_title,
    p_description,
    p_emoji_code,
    p_skills,
    p_visibility
  )
  returning id into new_post_id;

  return new_post_id;
end;
$$;


-- =======================================
-- RPC 2: Get posts for feed (FOR YOU feed)
-- =======================================
-- FOR YOU FEED = 
-- 1) global public posts
-- 2) college-only posts from same college
-- 3) posts from followed accounts

create or replace function public.get_feed_posts()
returns setof public.proof_posts
language sql
security definer
set search_path = public
as $$
  with user_student as (
    select id, college_id
    from public.student_profiles
    where user_id = auth.uid()
  ),
  following_list as (
    select following_id
    from public.follows
    where follower_id = auth.uid()
  )
  select pp.*
  from public.proof_posts pp
  where
    pp.visibility = 'public'
    or (pp.visibility = 'college' and exists (
      select 1
      from user_student us
      join public.student_profiles sp on sp.id = pp.student_id
      where us.college_id = sp.college_id
        and us.college_id is not null
    ))
    or pp.student_id in (select following_id from following_list)
  order by pp.created_at desc;
$$;


-- =======================================
-- RPC 3: like_post
-- =======================================

create or replace function public.like_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.post_likes (post_id, user_id)
  values (p_post_id, auth.uid())
  on conflict (post_id, user_id) do nothing;
end;
$$;


-- =======================================
-- RPC 4: unlike_post
-- =======================================

create or replace function public.unlike_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.post_likes
  where post_id = p_post_id and user_id = auth.uid();
end;
$$;


-- =======================================
-- RPC 5: add_comment
-- =======================================

create or replace function public.add_comment(
  p_post_id uuid,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_comment_id uuid;
begin
  -- Validate comment is not empty
  if trim(p_comment) = '' then
    raise exception 'Comment cannot be empty.';
  end if;

  insert into public.post_comments (post_id, user_id, comment)
  values (p_post_id, auth.uid(), p_comment)
  returning id into new_comment_id;

  return new_comment_id;
end;
$$;