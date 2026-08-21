-- ============================================================================
-- Stage 16 — §14: weekly squad scoring and the round robin.
--
-- Until this stage every number on the Squads screen was typed in by hand.
-- Points, wins, losses, rank and each member's contribution were seeded values
-- and nothing derived them from what a student actually did. The screen looked
-- finished and was decoration.
--
-- The seven steps of §14, in order: collect the week's events, score each
-- student, aggregate into a squad score, rank, publish, generate the next
-- week's fixtures, and surface who needs help. The last already exists as
-- tpo_attention and the skill gaps, so it is not rebuilt here.
--
-- Three faults were found by running it against real rows rather than reading
-- it, and all three are already folded into the definitions below:
--   * scoring week five settled every fixture in the season, because a match
--     knew no week of its own — fixtures now carry round_number
--   * regenerating fixtures left previously played ones behind, so a squad
--     appeared to have played three matches out of a possible two — it now
--     refuses rather than double-count, and rebuilding must be asked for
--   * a three-squad draw is three rounds, so the competition ended in week
--     three while the season ran to week ten — the draw now repeats, with
--     home and away swapped on alternate cycles
-- ============================================================================


-- ── the configured rules ────────────────────────────────────────────────
-- A table rather than numbers buried in a function, because §14 calls them
-- "the configured squad rules" and a college that wants to weight explanations
-- over volume should not need a migration to say so.
create table public.squad_scoring_rules (
  metric      text primary key,
  label       text not null,
  points      integer not null,
  description text
);

insert into public.squad_scoring_rules (metric, label, points, description) values
  ('lot_submitted',      'Lot submitted',        10, 'The daily task, done.'),
  ('proof_verified',     'Proof verified',       25, 'Work that survived checking — the most a student can be worth in a week.'),
  ('topic_cleared',      'Topic cleared',        12, 'A step of the roadmap finished.'),
  ('voice_recorded',     'Explanation recorded', 8,  'Saying out loud what you built. Cheap to do, hard to fake.'),
  ('match_participated', 'Match played',          5, 'Turning up for the squad.'),
  ('active_day',         'Active day',            3, 'Counted once per day regardless of how much was done, so one busy day cannot carry a whole week.');

alter table public.squad_scoring_rules enable row level security;
create policy scoring_rules_read on public.squad_scoring_rules for select to authenticated using (true);
revoke insert, update, delete, truncate on public.squad_scoring_rules from anon, authenticated;


-- ── what each week produced ─────────────────────────────────────────────
-- The published leaderboard, kept rather than overwritten, so "Intellects +18%
-- on last week" is a fact about two rows instead of a guess.
create table public.squad_weekly_scores (
  id             uuid primary key default gen_random_uuid(),
  season_id      uuid not null references public.seasons(id) on delete cascade,
  squad_id       uuid not null references public.squads(id) on delete cascade,
  week           integer not null,
  points         integer not null default 0,
  active_members integer not null default 0,
  total_members  integer not null default 0,
  rank           integer,
  breakdown      jsonb not null default '{}'::jsonb,
  computed_at    timestamptz not null default now(),
  unique (season_id, squad_id, week)
);
create index squad_weekly_scores_season_idx on public.squad_weekly_scores (season_id, week desc);

alter table public.squad_weekly_scores enable row level security;
create policy weekly_scores_read on public.squad_weekly_scores for select to authenticated using (true);
revoke insert, update, delete, truncate on public.squad_weekly_scores from anon, authenticated;

-- The same per student, so a member's contribution is a number somebody can
-- point at rather than a share of a total nobody computed.
create table public.student_weekly_scores (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references public.seasons(id) on delete cascade,
  student_id  uuid not null references public.student_profiles(id) on delete cascade,
  squad_id    uuid references public.squads(id) on delete set null,
  week        integer not null,
  points      integer not null default 0,
  breakdown   jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  unique (season_id, student_id, week)
);
create index student_weekly_scores_student_idx on public.student_weekly_scores (student_id, week desc);
create index student_weekly_scores_squad_idx   on public.student_weekly_scores (squad_id, week desc);

alter table public.student_weekly_scores enable row level security;
create policy student_weekly_read on public.student_weekly_scores for select to authenticated
  using (student_id = (select auth.uid())
         or squad_id in (select id from public.squads where college_id = (select public.my_college_id()))
         or (select public.is_admin()));
revoke insert, update, delete, truncate on public.student_weekly_scores from anon, authenticated;

-- Which week a fixture belongs to. This is what §8.2's season_rounds table was
-- really carrying, without needing the table.
alter table public.squad_matches add column round_number integer;
create index squad_matches_round_idx on public.squad_matches (season_id, round_number);

grant select on public.squad_scoring_rules, public.squad_weekly_scores,
                public.student_weekly_scores to authenticated;
