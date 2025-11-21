-- Fix security issue: Remove public access to materialized view that exposes auth.users
-- Revoke grants from the materialized view
revoke select on public.users_follow_counts from authenticated;
revoke select on public.users_follow_counts from anon;

-- Drop the materialized view as it exposes auth.users
drop materialized view if exists public.users_follow_counts;

-- Instead, create a secure helper function to get follow counts for any user
create or replace function public.get_user_follow_counts(target_user uuid)
returns table(followers_count bigint, following_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.follows where following_id = target_user) as followers_count,
    (select count(*) from public.follows where follower_id = target_user) as following_count;
$$;

-- Create a helper function to check if current user follows someone
create or replace function public.is_following(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.follows 
    where follower_id = auth.uid() and following_id = target_user
  );
$$;