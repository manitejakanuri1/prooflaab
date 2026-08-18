-- ============================================================================
-- Merging in the real features from the 8-9 August line of work, which ran in
-- parallel with this rebuild and never met it.
--
-- Kept, because each is real and working:
--   coding_streaks       LeetCode / HackerRank practice tracking
--   level sub-steps      a topic is now ordered explanation steps ending in a
--                        checkpoint, rather than one page and one quiz
--   sandbox              a live code sandbox on the level screen
--   code_example         a read-only code snapshot
--
-- Dropped from that line, deliberately:
--   its 3-hub navigation   the design deck asks for four destinations in a
--                          left sidebar, which is what this line built
--   its placeholder pages  equivalent placeholders already exist here
--
-- Two changes from their originals:
--   * their RLS looked up student_profiles.id from user_id. In the rebuilt
--     schema those are the same value, so the subquery returns what it was
--     given. Compared to auth.uid() directly instead.
--   * the streak counts are protected. A student links their username; the
--     sync job writes the numbers. Left as they had it, "current_streak = 9999"
--     was one request away.
-- ============================================================================

create table public.coding_streaks (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.student_profiles(id) on delete cascade,
  platform       text not null check (platform in ('leetcode', 'hackerrank')),
  username       text,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_active_date date,
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (student_id, platform)
);

create index coding_streaks_student_idx on public.coding_streaks (student_id);

create trigger coding_streaks_set_updated_at before update on public.coding_streaks
  for each row execute function public.set_updated_at();

alter table public.coding_streaks enable row level security;

create policy coding_streaks_own_read on public.coding_streaks for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());
create policy coding_streaks_own_insert on public.coding_streaks for insert to authenticated
  with check (student_id = (select auth.uid()));
create policy coding_streaks_own_update on public.coding_streaks for update to authenticated
  using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));

-- The student links the account. The sync job counts the days.
create trigger protect_coding_streaks before update on public.coding_streaks
  for each row execute function public.protect_columns(
    'current_streak', 'longest_streak', 'last_active_date', 'last_synced_at');


-- ── level sub-steps ──────────────────────────────────────────────────────
-- A level that is one page and one quiz is a lesson. A level broken into
-- explanation steps ending in a checkpoint is a path — which is what a level
-- MAP is meant to be.
--
-- The 140 already-seeded levels become sub_level 1 of their number and stay
-- checkpoints, so nothing already placed moves.
alter table public.levels
  add column sub_level integer not null default 1,
  add column kind text not null default 'checkpoint'
    check (kind in ('explanation', 'checkpoint'));

alter table public.levels drop constraint levels_track_slug_level_number_key;
alter table public.levels
  add constraint levels_track_slug_level_number_sub_level_key
  unique (track_slug, level_number, sub_level);

drop index if exists levels_track_idx;
create index levels_track_idx on public.levels (track_slug, level_number, sub_level);

-- An explanation step teaches and asks for no proof; only a checkpoint does.
alter table public.level_content
  add column sandbox jsonb,
  add column code_example jsonb;
alter table public.level_content alter column quiz set default '[]'::jsonb;
alter table public.level_content alter column proof_title drop not null;
alter table public.level_content alter column proof_brief drop not null;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke truncate, references, trigger on public.coding_streaks from anon, authenticated;
