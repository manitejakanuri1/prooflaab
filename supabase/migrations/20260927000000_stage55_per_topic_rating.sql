-- ============================================================================
-- Stage 55 — the adaptive brain, added underneath what already exists.
--
-- From Master Specification v2, sections 11 and 18. Nothing here replaces the
-- 146-step ladder, the Daily Lot engine, squads, seasons or leaderboards. It
-- adds a hidden per-topic rating that can inform which topic a student sees
-- next, and a place to learn how hard a question really is from real results.
--
-- THE INVARIANT THE SPEC CALLS ITS HIGHEST PRIORITY (section 18): per-topic
-- ratings are independent measurements. 1500 in Verbal Ability and 1500 in
-- Dynamic Programming describe two unrelated skills and must never be
-- averaged, summed, or stored as one composite "student score". There is
-- deliberately no such column in this migration, and none should ever be
-- added. If a composite is ever needed for a report, compute it at query time
-- and label it as derived.
--
-- Note this is separate from total_xp and squad points, which are effort and
-- competition counters, not skill measurements. Those already exist and are
-- untouched.
-- ============================================================================

create table if not exists public.topic_ratings (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.student_profiles(id) on delete cascade,
  topic        text not null,
  -- 1200 is the spec's flat starting point; 800-2200 is its stated range.
  rating       integer not null default 1200 check (rating between 800 and 2200),
  -- 0 = no evidence at all, 1 = well established. Grows as attempts accumulate.
  confidence   numeric(4,3) not null default 0 check (confidence between 0 and 1),
  attempts     integer not null default 0,
  last_seen    timestamptz,
  -- Tells a placement-seeded estimate apart from one earned by real attempts.
  seeded_by    text check (seeded_by in ('placement', 'attempt')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (student_id, topic)
);

create index if not exists topic_ratings_student_idx on public.topic_ratings (student_id);
create index if not exists topic_ratings_topic_idx   on public.topic_ratings (topic);

comment on table public.topic_ratings is
  'Hidden per-topic skill estimate, 800-2200. Never shown to a student and never combined across topics into a single score - see Master Specification v2 section 18.';

alter table public.topic_ratings enable row level security;

-- A student may read their own; the spec forbids showing it, but the column
-- being readable is what lets an admin diagnose. Nobody may write it directly:
-- ratings only move through record_topic_attempt().
create policy topic_ratings_own_read on public.topic_ratings
  for select to authenticated
  using (student_id = (select auth.uid()) or (select public.is_admin()));

-- How hard a question turned out to be in practice, as opposed to how hard the
-- AI guessed it was. Section 11: only trust this after a minimum sample.
create table if not exists public.question_calibration (
  id                 uuid primary key default gen_random_uuid(),
  level_id           uuid,
  topic              text not null,
  ai_difficulty      integer,
  attempts           integer not null default 0,
  correct            integer not null default 0,
  hint_used          integer not null default 0,
  skipped            integer not null default 0,
  total_seconds      bigint  not null default 0,
  observed_difficulty integer,
  updated_at         timestamptz not null default now(),
  unique (level_id, topic)
);

comment on table public.question_calibration is
  'Observed question behaviour. observed_difficulty stays null until the sample is large enough to mean anything.';

alter table public.question_calibration enable row level security;

-- Role tracks are a weighted mix across the whole topic tree, not a filter
-- (spec section 12) - otherwise a placement-track student never sees aptitude.
create table if not exists public.role_track_config (
  role_slug      text not null,
  topic_category text not null,
  weight         numeric(4,3) not null check (weight >= 0 and weight <= 1),
  primary key (role_slug, topic_category)
);

alter table public.role_track_config enable row level security;

create policy role_track_config_read on public.role_track_config
  for select to authenticated using (true);

insert into public.role_track_config (role_slug, topic_category, weight) values
  ('service_company', 'aptitude',      0.40),
  ('service_company', 'core_cs',       0.30),
  ('service_company', 'coding',        0.30),
  ('product_sde',     'coding',        0.70),
  ('product_sde',     'core_cs',       0.20),
  ('product_sde',     'aptitude',      0.10),
  ('data_analyst',    'sql_di',        0.35),
  ('data_analyst',    'aptitude',      0.25),
  ('data_analyst',    'core_cs',       0.20),
  ('data_analyst',    'coding',        0.20),
  ('undecided',       'coding',        0.25),
  ('undecided',       'aptitude',      0.25),
  ('undecided',       'core_cs',       0.25),
  ('undecided',       'verbal',        0.25)
on conflict (role_slug, topic_category) do nothing;

-- ---------------------------------------------------------------- the update

-- One attempt moves one topic. The numbers are the spec's own starting
-- heuristics (section 11), not scientific constants, and are meant to be
-- replaced by calibrated values later.
create or replace function public.record_topic_attempt(
  _student_id uuid,
  _topic      text,
  _outcome    text,                      -- correct | correct_hint | correct_slow | incorrect | skipped | error
  _level_id   uuid    default null,
  _seconds    integer default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare delta integer; new_rating integer; new_conf numeric;
begin
  -- An evaluator failure is not evidence about the student. Spec section 13.
  if _outcome = 'error' then
    return jsonb_build_object('ok', true, 'skipped', 'evaluator error, no rating change');
  end if;

  delta := case _outcome
             when 'correct'      then  25
             when 'correct_hint' then  12
             when 'correct_slow' then  10
             when 'incorrect'    then  -8
             when 'skipped'      then  -4
             else 0 end;

  insert into public.topic_ratings (student_id, topic, rating, confidence, attempts,
                                    last_seen, seeded_by)
  values (_student_id, _topic,
          greatest(800, least(2200, 1200 + delta)),
          0.15, 1, now(), 'attempt')
  on conflict (student_id, topic) do update
    set rating     = greatest(800, least(2200, public.topic_ratings.rating + delta)),
        -- Confidence approaches 1 as attempts pile up, never reaching it.
        confidence = least(0.95, public.topic_ratings.confidence + (1 - public.topic_ratings.confidence) * 0.15),
        attempts   = public.topic_ratings.attempts + 1,
        last_seen  = now(),
        seeded_by  = 'attempt',
        updated_at = now()
  returning rating, confidence into new_rating, new_conf;

  if _level_id is not null then
    insert into public.question_calibration
      (level_id, topic, attempts, correct, hint_used, skipped, total_seconds)
    values (_level_id, _topic, 1,
            case when _outcome like 'correct%' then 1 else 0 end,
            case when _outcome = 'correct_hint' then 1 else 0 end,
            case when _outcome = 'skipped' then 1 else 0 end,
            coalesce(_seconds, 0))
    on conflict (level_id, topic) do update
      set attempts      = public.question_calibration.attempts + 1,
          correct       = public.question_calibration.correct
                            + case when _outcome like 'correct%' then 1 else 0 end,
          hint_used     = public.question_calibration.hint_used
                            + case when _outcome = 'correct_hint' then 1 else 0 end,
          skipped       = public.question_calibration.skipped
                            + case when _outcome = 'skipped' then 1 else 0 end,
          total_seconds = public.question_calibration.total_seconds + coalesce(_seconds, 0),
          -- Only speak once there is enough evidence to be worth hearing.
          observed_difficulty = case
            when public.question_calibration.attempts + 1 >= 20
            then (2200 - ((public.question_calibration.correct
                           + case when _outcome like 'correct%' then 1 else 0 end)::numeric
                          / (public.question_calibration.attempts + 1) * 1400))::integer
            else public.question_calibration.observed_difficulty end,
          updated_at = now();
  end if;

  return jsonb_build_object('ok', true, 'rating', new_rating, 'confidence', new_conf);
end $function$;

-- Which topic this student most needs next. The spec's weights: 60% need,
-- 20% retention, 10% role relevance, 10% exploration. Returns a ranked list;
-- the caller decides what to do with it, so nothing about today's Lot engine
-- has to change for this to start being useful.
create or replace function public.topic_priorities(
  _student_id uuid,
  _limit      integer default 10
) returns table(topic text, rating integer, confidence numeric,
                days_since numeric, score numeric)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with mine as (
    select l.skill as topic,
           coalesce(r.rating, 1200)     as rating,
           coalesce(r.confidence, 0)    as confidence,
           case when r.last_seen is null then 999
                else extract(epoch from (now() - r.last_seen)) / 86400 end as days_since
      from public.levels l
      left join public.topic_ratings r
        on r.student_id = _student_id and r.topic = l.skill
     group by l.skill, r.rating, r.confidence, r.last_seen
  )
  select m.topic, m.rating, m.confidence, round(m.days_since, 1),
         round(
           -- need: a low rating, or a rating nothing supports yet
           0.60 * ((2200 - m.rating)::numeric / 1400 * (1 - m.confidence * 0.5))
           -- retention: the longer since it was touched, the more it is due
           + 0.20 * least(m.days_since / 30, 1)
           -- exploration: never-seen topics get a small standing nudge
           + 0.10 * case when m.confidence = 0 then 1 else 0 end
           -- role relevance is applied by the caller, which knows the student's
           -- track; leaving it out here keeps this function role-agnostic
           , 4) as score
    from mine m
   order by score desc, m.topic
   limit greatest(_limit, 1);
$function$;

revoke all on function public.record_topic_attempt(uuid, text, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.topic_priorities(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.record_topic_attempt(uuid, text, text, uuid, integer) to service_role;
grant execute on function public.topic_priorities(uuid, integer) to authenticated, service_role;
