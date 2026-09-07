-- ============================================================================
-- Stage 56 — placement assessment, and five deterministic answer types.
--
-- Master Specification v2, sections 10 and 12. Both additive: no existing
-- screen, table or flow changes.
--
-- PART A - PLACEMENT (section 10). Without it every student starts flat at
-- 1200 on every topic, and under one-task-per-day it takes about ten days of
-- single data points to find their real level - which is exactly the window in
-- which a new student decides whether to keep using the product. A one-time
-- set of 6-8 questions at signup seeds the starting estimate instead.
--
-- Placement is onboarding, not a daily task. It does not count against the
-- one-task-per-day rule, and it is provisional: real attempts move the rating
-- normally afterwards. seeded_by on topic_ratings is what tells the two apart.
--
-- PART B - ANSWER TYPES (section 12). Five new question shapes, all checked
-- deterministically in the database with no AI call at grading time. This is
-- what lets aptitude, reasoning and verbal content exist without adding a
-- per-submission AI cost - only free-text descriptive answers ever reach a
-- model.
-- ============================================================================

-- ------------------------------------------------------------ PART A

alter table public.student_profiles
  add column if not exists placement_completed_at timestamptz;

comment on column public.student_profiles.placement_completed_at is
  'When the one-time placement assessment was finished. Null means the student has never taken it; their ratings are defaults or earned from real attempts.';

-- The question set: 6-8 spread across the student's own tracks and across
-- difficulty, drawn from level_content that already exists. Nothing new has to
-- be authored for placement to work.
create or replace function public.placement_questions(_student_id uuid default null)
returns table(level_id uuid, track_slug text, topic text, level_number integer, quiz jsonb)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with me as (select coalesce(_student_id, (select auth.uid())) as sid),
  tracks as (
    select t.track_slug
      from public.student_tracks t, me
     where t.student_id = me.sid
  ),
  pool as (
    select l.id, l.track_slug, l.skill, l.level_number, c.quiz,
           -- easy / medium / hard by where the topic sits in its ladder
           case when l.level_number <= 4 then 'easy'
                when l.level_number <= 9 then 'medium'
                else 'hard' end as band,
           row_number() over (
             partition by case when l.level_number <= 4 then 'easy'
                               when l.level_number <= 9 then 'medium'
                               else 'hard' end
             order by md5(l.id::text || (select sid::text from me))
           ) as pick
      from public.levels l
      join public.level_content c on c.level_id = l.id
     where c.quiz is not null
       and (not exists (select 1 from tracks)
            or l.track_slug in (select track_slug from tracks))
  )
  -- 3 easy, 3 medium, 2 hard - the spec's own shape
  select id, track_slug, skill, level_number, quiz from pool
   where (band = 'easy' and pick <= 3)
      or (band = 'medium' and pick <= 3)
      or (band = 'hard' and pick <= 2)
   order by band desc, level_number;
$function$;

-- Seeds topic_ratings from the placement result. The seed values are the
-- spec's table: getting a hard one right says more than getting an easy one
-- right, and missing an easy one says more than missing a hard one.
create or replace function public.submit_placement(_results jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  sid uuid := (select auth.uid());
  r record; seeded integer := 0; seed_rating integer; seed_conf numeric;
begin
  if sid is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.student_profiles where id = sid) then
    raise exception 'only a student can take the placement assessment';
  end if;

  for r in
    select (e->>'topic')          as topic,
           (e->>'band')           as band,
           (e->>'correct')::bool  as correct
      from jsonb_array_elements(_results) e
     where e->>'topic' is not null
  loop
    if r.correct and r.band = 'hard' then
      seed_rating := 1400; seed_conf := 0.30;
    elsif r.correct and r.band = 'medium' then
      seed_rating := 1300; seed_conf := 0.20;
    elsif r.correct then
      seed_rating := 1200; seed_conf := 0.10;   -- expected: says little
    elsif not r.correct and r.band = 'easy' then
      seed_rating := 975;  seed_conf := 0.30;   -- informative miss
    elsif not r.correct and r.band = 'medium' then
      seed_rating := 1100; seed_conf := 0.20;
    else
      seed_rating := 1150; seed_conf := 0.10;   -- missing a hard one: expected
    end if;

    -- Never overwrite a rating the student has already earned by doing work.
    insert into public.topic_ratings (student_id, topic, rating, confidence,
                                      attempts, last_seen, seeded_by)
    values (sid, r.topic, seed_rating, seed_conf, 0, now(), 'placement')
    on conflict (student_id, topic) do update
      set rating     = case when public.topic_ratings.seeded_by = 'attempt'
                            then public.topic_ratings.rating else excluded.rating end,
          confidence = case when public.topic_ratings.seeded_by = 'attempt'
                            then public.topic_ratings.confidence else excluded.confidence end,
          updated_at = now();
    seeded := seeded + 1;
  end loop;

  update public.student_profiles
     set placement_completed_at = coalesce(placement_completed_at, now())
   where id = sid;

  return jsonb_build_object('ok', true, 'topics_seeded', seeded);
end $function$;

-- ------------------------------------------------------------ PART B

-- All five check deterministically. No model is called to mark any of them.
--
--   multi_select     order does not matter, the whole set must match
--   match_pairs      every left-hand term paired with the right right-hand one
--   ordering         sequence must match exactly
--   assertion_reason a single option letter, as in Indian placement exams
--   fill_blank       normalised string, with an accepted-synonyms list
--
-- _expected and _given are jsonb so one function covers every shape.
create or replace function public.check_answer(
  _answer_type text,
  _expected    jsonb,
  _given       jsonb
) returns boolean
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $function$
declare norm_expected text; norm_given text; syn jsonb;
begin
  if _given is null or _expected is null then return false; end if;

  case _answer_type

    when 'multi_select' then
      -- Set equality: same members, order and duplicates irrelevant.
      return (
        select coalesce(array_agg(distinct lower(trim(x))) filter (where x is not null), '{}')
          from jsonb_array_elements_text(_expected) x
      ) = (
        select coalesce(array_agg(distinct lower(trim(y))) filter (where y is not null), '{}')
          from jsonb_array_elements_text(_given) y
      );

    when 'match_pairs' then
      -- Every key in the expected object must be present and equal.
      return not exists (
        select 1 from jsonb_each_text(_expected) e
         where lower(trim(coalesce(_given->>e.key, ''))) is distinct from lower(trim(e.value))
      ) and (select count(*) from jsonb_object_keys(_expected))
        = (select count(*) from jsonb_object_keys(_given));

    when 'ordering' then
      -- Exact sequence.
      return (
        select coalesce(array_agg(lower(trim(x)) order by ord), '{}')
          from jsonb_array_elements_text(_expected) with ordinality as t(x, ord)
      ) = (
        select coalesce(array_agg(lower(trim(y)) order by ord), '{}')
          from jsonb_array_elements_text(_given) with ordinality as t(y, ord)
      );

    when 'assertion_reason' then
      return upper(trim(_expected #>> '{}')) = upper(trim(_given #>> '{}'));

    when 'fill_blank' then
      -- Case, surrounding space and internal double spaces are not the point.
      norm_expected := lower(regexp_replace(trim(coalesce(_expected->>'answer',
                                                          _expected #>> '{}')), '\s+', ' ', 'g'));
      norm_given    := lower(regexp_replace(trim(_given #>> '{}'), '\s+', ' ', 'g'));
      if norm_expected = norm_given then return true; end if;

      syn := _expected->'accepted';
      if syn is not null then
        return exists (
          select 1 from jsonb_array_elements_text(syn) s
           where lower(regexp_replace(trim(s), '\s+', ' ', 'g')) = norm_given
        );
      end if;
      return false;

    else
      -- Anything else is not this function's business; the caller keeps using
      -- whatever evaluator it already has.
      return null;
  end case;
end $function$;

revoke all on function public.placement_questions(uuid) from public, anon, authenticated;
revoke all on function public.submit_placement(jsonb)   from public, anon, authenticated;
revoke all on function public.check_answer(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.placement_questions(uuid) to authenticated, service_role;
grant execute on function public.submit_placement(jsonb)   to authenticated, service_role;
grant execute on function public.check_answer(text, jsonb, jsonb) to authenticated, service_role;
