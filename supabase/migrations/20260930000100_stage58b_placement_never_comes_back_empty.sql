-- ============================================================================
-- Stage 58b — placement was handing some students an empty assessment.
--
-- Found by walking the journey end to end rather than by reading the code.
--
-- placement_questions() filtered strictly to the student's own tracks. Level
-- content is written lazily, on first visit, so a track nobody has opened yet
-- has none - which is every one of the five tracks added in stage 43 (Prompt
-- Engineering, Quantitative Aptitude, Logical Reasoning, Verbal Ability, HR
-- and Behavioural Prep). A student who picked one of those at onboarding, on
-- day one of a real college, was offered a placement assessment of zero
-- questions.
--
-- The student's own track is still strongly preferred - it is the first
-- ordering key. The set is only topped up from elsewhere when their own tracks
-- cannot fill it, because a placement drawn from adjacent topics is a far
-- better starting estimate than no placement at all.
--
-- The row type gains `band` and `own_track` so the caller can pass the band
-- straight back to submit_placement() (which needs it to know how much a
-- right or wrong answer says) instead of recomputing it in the browser.
-- Changing the row type is why this drops and recreates rather than replacing.
--
-- Verified: the same student who was offered 0 questions is now offered 6
-- across easy and medium. There is no hard band yet because no content exists
-- above rung 9 - correct behaviour on a young content set, not a fault.
-- ============================================================================

drop function if exists public.placement_questions(uuid);

create or replace function public.placement_questions(_student_id uuid default null)
returns table(level_id uuid, track_slug text, topic text, level_number integer,
              band text, own_track boolean, quiz jsonb)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with me as (select coalesce(_student_id, (select auth.uid())) as sid),
  tracks as (
    select t.track_slug from public.student_tracks t, me where t.student_id = me.sid
  ),
  pool as (
    select l.id, l.track_slug, l.skill, l.level_number, c.quiz,
           case when l.level_number <= 4 then 'easy'
                when l.level_number <= 9 then 'medium'
                else 'hard' end as band,
           (l.track_slug in (select track_slug from tracks)) as own_track
      from public.levels l
      join public.level_content c on c.level_id = l.id
     where c.quiz is not null
  ),
  ranked as (
    select p.*,
           row_number() over (
             partition by p.band
             -- own track first, then a per-student shuffle that is stable so
             -- the same student reloading the page sees the same set
             order by p.own_track desc, md5(p.id::text || (select sid::text from me))
           ) as pick
      from pool p
  )
  select id, track_slug, skill, level_number, band, own_track, quiz
    from ranked
   where (band = 'easy'   and pick <= 3)
      or (band = 'medium' and pick <= 3)
      or (band = 'hard'   and pick <= 2)
   order by band desc, own_track desc, level_number;
$function$;

revoke all on function public.placement_questions(uuid) from public, anon, authenticated;
grant execute on function public.placement_questions(uuid) to authenticated, service_role;
