-- Create follows table
create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  -- prevent duplicate follows
  unique (follower_id, following_id),
  -- prevent self-follows
  check (follower_id != following_id)
);

-- Create indexes
create index follows_follower_id_idx on public.follows(follower_id);
create index follows_following_id_idx on public.follows(following_id);
create index follows_created_at_idx on public.follows(created_at desc);

-- Enable RLS
alter table public.follows enable row level security;

-- RLS Policies
-- Insert: user can follow only as themselves
create policy "Users can follow as themselves"
on public.follows
for insert
with check (follower_id = auth.uid());

-- Select: allow reading follows (for building follow lists and feed filters)
create policy "Users can read follows"
on public.follows
for select
using (true);

-- Delete: allow unfollow only by the follower
create policy "Users can unfollow themselves"
on public.follows
for delete
using (follower_id = auth.uid());

-- Helper functions to fetch counts (lightweight; computed on demand)

-- get follower count for a user
create or replace function public.get_follower_count(target_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(1)::integer from public.follows where following_id = target_user;
$$;

-- get following count for a user
create or replace function public.get_following_count(target_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(1)::integer from public.follows where follower_id = target_user;
$$;

-- Optional convenience view: users_with_follow_counts
-- (Does not alter users table; returns counts on demand)
create materialized view if not exists public.users_follow_counts as
select
  u.id as user_id,
  coalesce(followers.count, 0) as followers_count,
  coalesce(followings.count, 0) as following_count
from auth.users u
left join lateral (
  select count(1) as count from public.follows where following_id = u.id
) followers on true
left join lateral (
  select count(1) as count from public.follows where follower_id = u.id
) followings on true;

-- Create index on materialized view for fast lookup
create unique index if not exists users_follow_counts_user_id_idx on public.users_follow_counts(user_id);

-- Grant access to the materialized view
grant select on public.users_follow_counts to authenticated;
grant select on public.users_follow_counts to anon;