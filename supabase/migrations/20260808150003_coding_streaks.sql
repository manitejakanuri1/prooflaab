-- Daily coding-practice streaks (LeetCode auto-synced via public GraphQL,
-- HackerRank manual check-in since it has no public API for this).
create table public.coding_streaks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  platform text not null check (platform in ('leetcode', 'hackerrank')),
  username text,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_active_date date,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, platform)
);

create index idx_coding_streaks_student_id on public.coding_streaks(student_id);

alter table public.coding_streaks enable row level security;

create policy "Students manage their own coding streaks"
  on public.coding_streaks
  for all
  to authenticated
  using (student_id = (select id from public.student_profiles where user_id = (select auth.uid())))
  with check (student_id = (select id from public.student_profiles where user_id = (select auth.uid())));
