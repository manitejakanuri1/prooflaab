-- Create post_comments table
create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.proof_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  comment text not null,
  created_at timestamptz default now()
);

-- Create indexes
create index post_comments_post_id_idx on public.post_comments(post_id);
create index post_comments_user_id_idx on public.post_comments(user_id);
create index post_comments_created_at_idx on public.post_comments(created_at desc);

-- Atomic comments counter trigger function
create or replace function public.update_post_comments_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.proof_posts
    set comments_count = comments_count + 1
    where id = new.post_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.proof_posts
    set comments_count = greatest(comments_count - 1, 0)
    where id = old.post_id;
    return old;
  end if;
end;
$$;

-- Create trigger
create trigger post_comments_counter_trigger
after insert or delete on public.post_comments
for each row
execute procedure public.update_post_comments_count();

-- Enable RLS
alter table public.post_comments enable row level security;

-- RLS Policies
-- Insert: users can comment only as themselves
create policy "Users can comment as themselves"
on public.post_comments
for insert
with check (user_id = auth.uid());

-- Select: users can read all comments
create policy "Users can read comments"
on public.post_comments
for select
using (true);

-- Delete: users can delete only their own comments
create policy "Users can delete their own comments"
on public.post_comments
for delete
using (user_id = auth.uid());