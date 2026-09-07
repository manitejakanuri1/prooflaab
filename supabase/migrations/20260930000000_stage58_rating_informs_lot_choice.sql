-- ============================================================================
-- Stage 58 — the per-topic rating starts choosing, in the safest place it can.
--
-- Stage 55 built the rating and topic_priorities(); nothing called them. This
-- connects the rating to the one decision that matters - which Lot a student
-- gets - without changing the shape of the ladder at all.
--
-- WHAT DOES NOT CHANGE. The planned-week branch is untouched: if a student has
-- a week plan, it still wins. In the fallback branch, level_number is still the
-- first ordering key, so a student can never skip ahead of their unlock wall
-- and progression is exactly what it was.
--
-- WHAT DOES. When several topics sit on the same rung - up to ten of them in
-- this ladder - the rating decides which one. The weakest topic, discounted by
-- how little evidence supports that estimate, is served first.
--
-- WHY IT IS SAFE TO SHIP BEFORE A DEMO. The new sort key is
-- (2200 - rating)/1400 * (1 - confidence/2), and a student with no ratings has
-- no row in topic_ratings, so coalesce makes that term 0 for every candidate.
-- The order then collapses to (level_number, sub_level) - the previous
-- behaviour exactly. Nothing changes for anyone until they have actually been
-- rated, whether by placement or by real attempts.
--
-- Verified end to end: a student who missed an easy Percentages question in
-- placement (seeded 975) was then served Percentages, still on rung 1.
-- ============================================================================

create or replace function public.next_lot_level(_student_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with track as (
    select track_slug, coalesce(unlocked_through, 1) as wall
      from public.student_tracks
     where student_id = _student_id order by created_at desc limit 1
  ), planned as (
    select p.level_id, p.slot
      from public.student_week_plan p
      join public.levels l on l.id = p.level_id
      join track t on t.track_slug = l.track_slug
      left join public.student_levels sl
        on sl.level_id = p.level_id and sl.student_id = _student_id
     where p.student_id = _student_id
       and p.week_start = date_trunc('week', current_date)::date
       and coalesce(sl.status, 'new') not in ('cleared', 'mastered', 'placed')
       and l.level_number <= t.wall
     order by p.slot
     limit 1
  ), fallback as (
    select l.id as level_id
      from public.levels l
      join track t on t.track_slug = l.track_slug
      left join public.student_levels sl
        on sl.level_id = l.id and sl.student_id = _student_id
      left join public.topic_ratings tr
        on tr.student_id = _student_id and tr.topic = l.skill
     where coalesce(sl.status, 'new') not in ('cleared', 'mastered', 'placed')
       and l.level_number <= t.wall
     -- Ladder order still comes first, so nobody skips ahead and progression is
     -- exactly what it was. The rating only decides which topic to serve when
     -- several sit on the same rung: the weakest, least-supported one wins.
     -- A student with no ratings scores identically on every row, so the order
     -- collapses to (level_number, sub_level) - the previous behaviour.
     order by l.level_number,
              (coalesce(2200 - tr.rating, 0)::numeric / 1400
               * (1 - coalesce(tr.confidence, 0) * 0.5)) desc,
              l.sub_level
     limit 1
  )
  select coalesce((select level_id from planned), (select level_id from fallback));
$function$;
