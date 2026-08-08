-- Both of these read `follows`, a table nothing has ever written to, so both
-- have always returned nothing. Every follow the product creates goes into
-- `user_follows` via follow_user().
--
-- The two tables also disagree about what an id means: `follows` was meant to
-- hold student_profiles ids, `user_follows` holds auth user ids. So this is not
-- a rename -- get_feed_posts has to join through student_profiles to turn the
-- auth ids it now reads back into the student ids proof_posts is keyed by.

CREATE OR REPLACE FUNCTION public.get_user_follow_counts(target_user uuid)
RETURNS TABLE(followers_count bigint, following_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select
    (select count(*) from public.user_follows where following_id = target_user) as followers_count,
    (select count(*) from public.user_follows where follower_id  = target_user) as following_count;
$function$;

CREATE OR REPLACE FUNCTION public.get_feed_posts()
RETURNS SETOF proof_posts
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with user_student as (
    select id, college_id
    from public.student_profiles
    where user_id = (select auth.uid())
  ),
  -- user_follows stores auth user ids; proof_posts.student_id is a
  -- student_profiles id. The join is what makes the comparison mean anything.
  following_students as (
    select sp.id as student_id
    from public.user_follows uf
    join public.student_profiles sp on sp.user_id = uf.following_id
    where uf.follower_id = (select auth.uid())
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
    or pp.student_id in (select student_id from following_students)
  order by pp.created_at desc;
$function$;

-- CREATE OR REPLACE resets the ACL to the default, which hands EXECUTE back to
-- PUBLIC. Neither function is called by the app, so take it away again.
REVOKE ALL ON FUNCTION public.get_user_follow_counts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_feed_posts() FROM PUBLIC;
