-- ============================================================================
-- Stage 7 — the daily Lot, the skill ladder, and Squad.
--
-- Assumptions, stated because they were asked for and not answered:
--   * a squad holds up to 11 — the deck says "the 11 members"
--   * squads belong to a college, the only grouping this product already has
--   * a season is a run of weeks; a match is two squads in one week
--   * points are earned by members during the season
-- Each is one column or one value, so each is cheap to change later.
-- ============================================================================

-- ── Daily Lot ────────────────────────────────────────────────────────────
alter table public.tasks
  add column lot_number        integer,
  add column estimate_minutes  integer,
  add column code_sample       text,
  add column source_jd         text,
  add column lot_date          date,
  add column lot_category      text
    check (lot_category is null or lot_category in ('technical', 'business', 'pitch'));

-- One Lot per student per day. Without this the "daily" card is a task list
-- with a date printed on it.
create unique index tasks_one_lot_per_day
  on public.tasks (student_id, lot_date) where lot_date is not null;
create index tasks_lot_date_idx on public.tasks (lot_date);
create sequence if not exists public.lot_number_seq;

create or replace function public.my_todays_lot()
returns table (
  id uuid, lot_number integer, title text, description text,
  code_sample text, source_jd text, difficulty text,
  estimate_minutes integer, lot_category text, status text, due_date timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $fn$
  select t.id, t.lot_number, t.title, t.description, t.code_sample, t.source_jd,
         t.difficulty, t.estimate_minutes, t.lot_category, t.status, t.due_date
  from public.tasks t
  where t.student_id = auth.uid() and t.lot_date = current_date
  limit 1;
$fn$;
revoke all on function public.my_todays_lot() from public, anon;
grant execute on function public.my_todays_lot() to authenticated;


-- ── Skills: Claimed → Assessed → Proven ──────────────────────────────────
-- The three stages are earned by different evidence, so the row records which
-- evidence exists rather than trusting a label someone typed.
create table public.student_skills (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.student_profiles(id) on delete cascade,
  skill          text not null,
  status         text not null default 'claimed'
                   check (status in ('claimed', 'assessed', 'proven')),
  claimed_from   text,
  assessed_score integer,
  proven_lots    integer not null default 0,
  proven_voice   integer not null default 0,
  last_evidence_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (student_id, skill)
);
create index student_skills_student_idx on public.student_skills (student_id);
create trigger student_skills_set_updated_at before update on public.student_skills
  for each row execute function public.set_updated_at();


-- ── Squad ────────────────────────────────────────────────────────────────
create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null, starts_on date not null, ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index seasons_one_current on public.seasons (is_current) where is_current;

create table public.squads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  college_id uuid references public.colleges(id) on delete set null,
  season_id  uuid references public.seasons(id) on delete set null,
  max_members integer not null default 11,
  points integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  rank integer, previous_rank integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.squad_members (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  role text, contribution integer not null default 0,
  joined_at timestamptz not null default now(),
  meet_url text,
  unique (student_id, squad_id)
);

-- A student belongs to one squad at a time. Two would make "my squad" a
-- question with two answers, and every screen in the deck assumes one.
create unique index squad_members_one_squad_per_student on public.squad_members (student_id);

create table public.squad_matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete cascade,
  home_squad uuid not null references public.squads(id) on delete cascade,
  away_squad uuid not null references public.squads(id) on delete cascade,
  scheduled_at timestamptz not null,
  home_points integer, away_points integer,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'played', 'cancelled')),
  created_at timestamptz not null default now(),
  constraint squad_matches_two_sides check (home_squad <> away_squad)
);

create index squad_members_squad_idx on public.squad_members (squad_id);
create index squad_matches_season_idx on public.squad_matches (season_id, scheduled_at);
create index squad_matches_home_idx on public.squad_matches (home_squad);
create index squad_matches_away_idx on public.squad_matches (away_squad);
create index squads_college_idx on public.squads (college_id);
create index squads_season_idx on public.squads (season_id);
create trigger squads_set_updated_at before update on public.squads
  for each row execute function public.set_updated_at();

alter table public.student_skills enable row level security;
alter table public.seasons enable row level security;
alter table public.squads enable row level security;
alter table public.squad_members enable row level security;
alter table public.squad_matches enable row level security;

create policy student_skills_own_read on public.student_skills for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());

-- Standings are meant to be seen. A league nobody can look at is not a league.
create policy seasons_read on public.seasons for select to authenticated using (true);
create policy squads_read on public.squads for select to authenticated using (true);
create policy squad_members_read on public.squad_members for select to authenticated using (true);
create policy squad_matches_read on public.squad_matches for select to authenticated using (true);

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- Everything about a squad or a skill status is decided by the system or an
-- admin. A student who could write these could award their own squad the season.
revoke insert, update, delete on public.student_skills from authenticated, anon;
revoke insert, update, delete on public.seasons from authenticated, anon;
revoke insert, update, delete on public.squads from authenticated, anon;
revoke insert, update, delete on public.squad_members from authenticated, anon;
revoke insert, update, delete on public.squad_matches from authenticated, anon;
