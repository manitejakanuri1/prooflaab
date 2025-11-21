-- Create post_likes table
create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.proof_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  
  -- prevent duplicate likes
  unique (post_id, user_id)
);

-- Create indexes
create index post_likes_post_id_idx on public.post_likes(post_id);
create index post_likes_user_id_idx on public.post_likes(user_id);

-- Atomic like counter trigger function
create or replace function public.update_post_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.proof_posts
    set likes_count = likes_count + 1
    where id = new.post_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.proof_posts
    set likes_count = greatest(likes_count - 1, 0)
    where id = old.post_id;
    return old;
  end if;
end;
$$;

-- Create trigger
create trigger post_likes_counter_trigger
after insert or delete on public.post_likes
for each row
execute procedure public.update_post_likes_count();

-- Enable RLS
alter table public.post_likes enable row level security;

-- RLS Policies
-- Insert: user can like any post
create policy "Users can like posts they can see"
on public.post_likes
for insert
with check (user_id = auth.uid());

-- Select: users can fetch likes for counts or UI
create policy "Users can read likes"
on public.post_likes
for select
using (true);

-- Delete: user can unlike only their own like
create policy "Users can unlike their own likes"
on public.post_likes
for delete
using (user_id = auth.uid());