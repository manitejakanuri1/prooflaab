-- ============================================================================
-- Stage 5 — the level map.
--
-- levels and level_content are the same for everybody: written once, read by
-- every student. student_tracks and student_levels are per student. Keeping
-- them apart is what makes each lesson cost one AI call rather than one per
-- student — 140 calls instead of 1.4 million at 10,000 students.
-- ============================================================================

create table public.level_tracks (
  slug        text primary key,
  name        text not null,
  emoji       text not null default '🚀',
  interest    text not null,
  role        text,
  sort_order  integer not null default 0
);

create table public.levels (
  id           uuid primary key default gen_random_uuid(),
  track_slug   text not null references public.level_tracks(slug) on delete cascade,
  level_number integer not null,
  skill        text not null,
  title        text not null,
  unique (track_slug, level_number)
);

-- quiz holds correct_index. The browser never reads this table — level-open
-- strips the answers before sending a question out — so it is locked the same
-- way conceptual_answer_keys is: RLS on, no policy, grant revoked.
create table public.level_content (
  level_id     uuid primary key references public.levels(id) on delete cascade,
  explanation  text not null,
  quiz         jsonb not null,
  proof_title  text not null,
  proof_brief  text not null,
  generated_at timestamptz not null default now()
);

create table public.student_tracks (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.student_profiles(id) on delete cascade,
  track_slug       text not null references public.level_tracks(slug) on delete cascade,
  is_primary       boolean not null default false,
  placed_at_level  integer not null default 0,
  unlocked_through integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (student_id, track_slug)
);

create table public.student_levels (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_profiles(id) on delete cascade,
  level_id    uuid not null references public.levels(id) on delete cascade,
  task_id     uuid references public.tasks(id) on delete set null,
  status      text not null default 'locked',
  attempts    integer not null default 0,
  best_score  integer not null default 0,
  evidence    text,
  cleared_at  timestamptz,
  mastered_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (student_id, level_id)
);

create trigger student_tracks_set_updated_at before update on public.student_tracks
  for each row execute function public.set_updated_at();
create trigger student_levels_set_updated_at before update on public.student_levels
  for each row execute function public.set_updated_at();

create index levels_track_idx on public.levels (track_slug, level_number);
create index student_tracks_student_idx on public.student_tracks (student_id);
create index student_levels_student_idx on public.student_levels (student_id);
create index student_levels_level_idx on public.student_levels (level_id);
create index student_levels_task_idx on public.student_levels (task_id);

alter table public.level_tracks enable row level security;
alter table public.levels enable row level security;
alter table public.level_content enable row level security;
alter table public.student_tracks enable row level security;
alter table public.student_levels enable row level security;

-- The map itself is public knowledge: everyone sees the same tracks and steps.
create policy level_tracks_read on public.level_tracks for select to authenticated using (true);
create policy levels_read on public.levels for select to authenticated using (true);

-- level_content: no policy on purpose. The quiz answers live here.

create policy student_tracks_read on public.student_tracks for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());
create policy student_levels_read on public.student_levels for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());

-- Progress is written by the level functions running as the service role, never
-- by the browser. A student who could write student_levels could mark every
-- level cleared without answering a single question.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
revoke all on public.level_content from authenticated, anon;
revoke insert, update, delete on public.level_tracks from authenticated, anon;
revoke insert, update, delete on public.levels from authenticated, anon;
revoke insert, update, delete on public.student_tracks from authenticated, anon;
revoke insert, update, delete on public.student_levels from authenticated, anon;
