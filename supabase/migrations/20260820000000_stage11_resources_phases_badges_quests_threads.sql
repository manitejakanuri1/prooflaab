-- ============================================================================
-- Five additions from the roadmap spec.
--
-- Most of that spec already existed here: roles and paths are inferred without
-- asking (suggest_tracks), topics run in a fixed order (levels), students start
-- where their resume proves they can (placeStudent), micro-lessons are the
-- sub_level/kind split, checkpoints have a pass mark, and XP, streaks and
-- leaderboards are already live.
--
-- These are the parts that genuinely were not there. The roadmap stays the
-- artefact; all of this sits on top of it rather than replacing it.
-- ============================================================================

-- ── 1. web resources ────────────────────────────────────────────────────
-- Somewhere to go and learn a topic properly before the quiz. Stored on the
-- checkpoint row, because that is where a student finds out they did not
-- understand it — so that is where "go read this" has to be.
--
-- The generator is told to give a url ONLY for a canonical docs home it is
-- certain of, and a search phrase for everything else. A model asked for deep
-- links invents them, and a 404 inside a lesson is worse than no link at all.
-- A search phrase cannot rot.
alter table public.level_content add column resources jsonb;


-- ── 2. phases ───────────────────────────────────────────────────────────
-- The ladder was flat: sixteen numbered steps with no shape. A phase groups
-- them, so a student sees where they are in the journey rather than only which
-- number they are on.
create table public.track_phases (
  id           uuid primary key default gen_random_uuid(),
  track_slug   text not null references public.level_tracks(slug) on delete cascade,
  phase_number integer not null,
  name         text not null,
  goal         text,
  from_level   integer not null,
  to_level     integer not null,
  created_at   timestamptz not null default now(),
  unique (track_slug, phase_number)
);

create index track_phases_track_idx on public.track_phases (track_slug, phase_number);


-- ── 3. badges ───────────────────────────────────────────────────────────
create table public.badges (
  slug        text primary key,
  name        text not null,
  emoji       text not null default '🏅',
  description text not null,
  rule_kind   text not null check (rule_kind in ('phase', 'streak', 'proof', 'level')),
  rule_value  integer,
  track_slug  text references public.level_tracks(slug) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.student_badges (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  badge_slug text not null references public.badges(slug) on delete cascade,
  awarded_at timestamptz not null default now(),
  unique (student_id, badge_slug)
);

create index student_badges_student_idx on public.student_badges (student_id, awarded_at desc);


-- ── 4. quests ───────────────────────────────────────────────────────────
create table public.quests (
  slug        text primary key,
  name        text not null,
  description text not null,
  cadence     text not null check (cadence in ('daily', 'weekly')),
  metric      text not null,
  target      integer not null default 1,
  xp_reward   integer not null default 10,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- period_start is the day (daily) or the Monday (weekly) an instance belongs
-- to, so the same quest can be completed again tomorrow without a second table.
create table public.student_quests (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.student_profiles(id) on delete cascade,
  quest_slug   text not null references public.quests(slug) on delete cascade,
  period_start date not null,
  progress     integer not null default 0,
  completed_at timestamptz,
  unique (student_id, quest_slug, period_start)
);

create index student_quests_student_idx on public.student_quests (student_id, period_start desc);


-- ── 5. discussion threads ───────────────────────────────────────────────
-- One per topic, so a stuck student asks where they are stuck.
create table public.topic_threads (
  id         uuid primary key default gen_random_uuid(),
  level_id   uuid not null unique references public.levels(id) on delete cascade,
  post_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.thread_posts (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.topic_threads(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index thread_posts_thread_idx on public.thread_posts (thread_id, created_at);
create index thread_posts_author_idx on public.thread_posts (author_id);

create or replace function public.thread_post_count()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if tg_op = 'INSERT' then
    update public.topic_threads set post_count = post_count + 1 where id = new.thread_id;
    return new;
  else
    update public.topic_threads set post_count = greatest(post_count - 1, 0) where id = old.thread_id;
    return old;
  end if;
end $fn$;

create trigger thread_post_count after insert or delete on public.thread_posts
  for each row execute function public.thread_post_count();


-- ── security ────────────────────────────────────────────────────────────
alter table public.track_phases enable row level security;
alter table public.badges enable row level security;
alter table public.student_badges enable row level security;
alter table public.quests enable row level security;
alter table public.student_quests enable row level security;
alter table public.topic_threads enable row level security;
alter table public.thread_posts enable row level security;

-- Catalogues are public knowledge: the map, the badges you could earn, the
-- quests on offer. Seeing them is part of wanting them.
create policy track_phases_read on public.track_phases for select to authenticated using (true);
create policy badges_read on public.badges for select to authenticated using (true);
create policy quests_read on public.quests for select to authenticated using (true);

-- Earned badges are public. A badge nobody can see is not a badge.
create policy student_badges_read on public.student_badges for select to authenticated using (true);

-- Quest progress is your own business.
create policy student_quests_read on public.student_quests for select to authenticated
  using (student_id = (select auth.uid()) or public.is_admin());

create policy topic_threads_read on public.topic_threads for select to authenticated using (true);
create policy thread_posts_read on public.thread_posts for select to authenticated using (true);
create policy thread_posts_own_insert on public.thread_posts for insert to authenticated
  with check (author_id = (select auth.uid()));
create policy thread_posts_own_update on public.thread_posts for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy thread_posts_own_delete on public.thread_posts for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_admin());

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- Awarding a badge and advancing a quest are the system's job. A student who
-- could write these would award themselves everything, and a badge you can
-- give yourself is worth nothing.
revoke insert, update, delete on public.track_phases from anon, authenticated;
revoke insert, update, delete on public.badges from anon, authenticated;
revoke insert, update, delete on public.student_badges from anon, authenticated;
revoke insert, update, delete on public.quests from anon, authenticated;
revoke insert, update, delete on public.student_quests from anon, authenticated;
revoke insert, update, delete on public.topic_threads from anon, authenticated;
revoke truncate, references, trigger on public.thread_posts from anon, authenticated;


-- ── seed ────────────────────────────────────────────────────────────────
-- Named in the product's voice: the lesson explains plainly, the celebration is
-- allowed to enjoy itself.
insert into public.badges (slug, name, emoji, description, rule_kind, rule_value) values
  ('first-blood',    'First Blood',      '🩸', 'Cleared your first topic. It only gets better from here.',         'level',  1),
  ('ten-down',       'Ten Down',         '🔟', 'Ten topics cleared. You are past the part where people quit.',     'level',  10),
  ('twenty-five',    'Quarter Century',  '🎯', 'Twenty-five topics. That is a real skill now, not a claim.',       'level',  25),
  ('week-warrior',   'Week Warrior',     '🔥', 'Seven days in a row. Consistency beats intensity.',                'streak', 7),
  ('month-machine',  'Month Machine',    '⚡', 'Thirty days without breaking the chain. Genuinely hard.',          'streak', 30),
  ('century-streak', 'Hundred Club',     '💯', 'One hundred days. At this point it is who you are.',               'streak', 100),
  ('first-proof',    'Proven Once',      '✅', 'Your first verified proof. Someone checked, and it held up.',      'proof',  1),
  ('five-proofs',    'Five Deep',        '🧱', 'Five verified proofs. A build-log a recruiter can actually read.', 'proof',  5),
  ('twenty-proofs',  'Portfolio Weight', '🏗️', 'Twenty verified proofs. This is a body of work.',                  'proof',  20),
  ('phase-clear',    'Phase Cleared',    '🚪', 'Finished a whole phase of your path.',                             'phase',  1);

-- Small enough to finish today, and tied to work that already counts.
insert into public.quests (slug, name, description, cadence, metric, target, xp_reward) values
  ('daily-lot',       'Today''s Lot',       'Submit the Lot waiting on your Daily Card.',         'daily',  'lot_submitted',  1, 20),
  ('daily-explain',   'Say It Out Loud',    'Record one 60-second explanation of your own work.', 'daily',  'voice_recorded', 1, 15),
  ('daily-topic',     'One Topic Down',     'Clear one topic checkpoint on your roadmap.',        'daily',  'topic_cleared',  1, 15),
  ('weekly-three',    'Three For The Week', 'Clear three topics this week.',                      'weekly', 'topic_cleared',  3, 60),
  ('weekly-proof',    'Ship Something',     'Get one proof verified this week.',                  'weekly', 'proof_verified', 1, 80),
  ('weekly-five-lots','Five Lots',          'Submit five daily Lots this week.',                  'weekly', 'lot_submitted',  5, 100);

-- Phases are derived from the seeded levels rather than written per track, so
-- all twelve tracks get a shape without inventing twelve sets of content. Four
-- phases across whatever length a track happens to be.
insert into public.track_phases (track_slug, phase_number, name, goal, from_level, to_level)
select t.slug, p.n, p.name, p.goal,
       greatest(1, floor((p.n - 1) * c.total / 4.0)::int + 1),
       least(c.total, floor(p.n * c.total / 4.0)::int)
from public.level_tracks t
join (select track_slug, count(*)::int as total from public.levels
       where sub_level = 1 group by track_slug) c on c.track_slug = t.slug
cross join (values
  (1, 'Foundations',  'The basics everything else assumes you already have.'),
  (2, 'Core Skills',  'The day-to-day tools of the role, used properly rather than copied.'),
  (3, 'Real Systems', 'Putting the pieces together the way they are actually combined at work.'),
  (4, 'Job Ready',    'The parts that separate someone who has learned this from someone who can be hired for it.')
) as p(n, name, goal)
where floor((p.n - 1) * c.total / 4.0)::int + 1 <= least(c.total, floor(p.n * c.total / 4.0)::int);
