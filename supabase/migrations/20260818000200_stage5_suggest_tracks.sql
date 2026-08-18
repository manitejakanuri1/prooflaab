-- ============================================================================
-- Fix #8 — the roadmap suggests, instead of asking.
--
-- Before: twelve identical buttons and no way to choose between them, so
-- students picked more or less at random and got a path that did not match what
-- they could already do.
--
-- Now: the tracks are ranked against what the student has actually claimed and
-- proved, and the best two come back with the reason spelled out —
-- "You already have React, Node.js and 3 more — 5 of the 16 steps."
--
-- Deliberately a lookup and not a model call. It runs on every visit to an
-- empty map, the answer has to be the same twice running, and "you already have
-- React" is a fact rather than something worth paying an LLM to phrase.
-- ============================================================================

create or replace function public.suggest_tracks(_student_id uuid, _limit integer default 2)
returns table (
  slug           text,
  name           text,
  emoji          text,
  role           text,
  total_steps    integer,
  matched_steps  integer,
  match_pct      integer,
  matched_skills text[],
  from_interest  boolean,
  reason         text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with evidence as (
    select distinct lower(regexp_replace(s, '[\s._\-]', '', 'g')) as norm, s as raw
    from (
      select unnest(rc.skills) as s
        from public.resume_claims rc where rc.student_id = _student_id
      union all
      select unnest(si.skills)
        from public.student_interests si where si.student_id = _student_id
      union all
      select unnest(sp.preferred_skills)
        from public.student_profiles sp where sp.id = _student_id
    ) t
    where s is not null and s <> ''
  ),
  interests as (
    select distinct i as interest
    from (
      select unnest(sp.key_interests) as i
        from public.student_profiles sp where sp.id = _student_id
      union all
      select unnest(si.interests)
        from public.student_interests si where si.student_id = _student_id
    ) x
    where i is not null and i <> ''
  ),
  scored as (
    select
      t.slug, t.name, t.emoji, t.role, t.sort_order,
      count(l.id)::int as total_steps,
      count(e.norm)::int as matched_steps,
      array_remove(array_agg(e.raw order by l.level_number), null) as matched_skills,
      exists (select 1 from interests i where i.interest = t.interest) as from_interest
    from public.level_tracks t
    join public.levels l on l.track_slug = t.slug
    left join evidence e
      on e.norm = lower(regexp_replace(l.skill, '[\s._\-]', '', 'g'))
    group by t.slug, t.name, t.emoji, t.role, t.sort_order
  )
  select
    s.slug, s.name, s.emoji, s.role,
    s.total_steps,
    s.matched_steps,
    case when s.total_steps = 0 then 0
         else round(100.0 * s.matched_steps / s.total_steps)::int end as match_pct,
    s.matched_skills,
    s.from_interest,
    case
      when s.matched_steps = 0 and s.from_interest then
        'You said you are interested in this. Nothing on your resume yet — a clean start.'
      when s.matched_steps = 0 then
        'A new direction. You would start from step 1.'
      when s.matched_steps = 1 then
        'You already have ' || s.matched_skills[1] || ' — 1 of the ' || s.total_steps || ' steps.'
      when s.matched_steps = 2 then
        'You already have ' || s.matched_skills[1] || ' and ' || s.matched_skills[2]
        || ' — 2 of the ' || s.total_steps || ' steps.'
      else
        'You already have ' || s.matched_skills[1] || ', ' || s.matched_skills[2]
        || ' and ' || (s.matched_steps - 2) || ' more — ' || s.matched_steps
        || ' of the ' || s.total_steps || ' steps.'
    end as reason
  from scored s
  -- Evidence first, then how much of the track it covers, then whether they
  -- said they were interested. Interest alone never outranks proof, but it does
  -- decide the order for a beginner who has no evidence at all.
  order by s.matched_steps desc, match_pct desc, s.from_interest desc, s.sort_order
  limit greatest(_limit, 1);
$fn$;

revoke all on function public.suggest_tracks(uuid, integer) from public, anon, authenticated;

-- A student may ask for their own suggestions and nobody else's. The
-- two-argument version stays admin/service-only so it cannot be used to probe
-- what another student has on their resume.
create or replace function public.my_suggested_tracks(_limit integer default 2)
returns table (
  slug text, name text, emoji text, role text,
  total_steps integer, matched_steps integer, match_pct integer,
  matched_skills text[], from_interest boolean, reason text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select * from public.suggest_tracks(auth.uid(), _limit);
$fn$;

revoke all on function public.my_suggested_tracks(integer) from public, anon;
grant execute on function public.my_suggested_tracks(integer) to authenticated;
