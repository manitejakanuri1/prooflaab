-- ============================================================================
-- Stage 34 — two doors into the platform, and neither one contaminates the
-- other.
--
-- A student arrives either by signing up alone or by being imported from their
-- college's CSV. Three things have to be true and only one of them was:
--
--   1. a self-signed-up student their college later imports must be LINKED,
--      keeping every bit of work they already did
--   2. a student who already belongs to another college must be untouchable
--   3. a student with no college is genuinely outside every college's world —
--      not half-inside one by accident
--
-- Rule 3 was already almost true: squads, members, matches, weekly scores,
-- seasons and badges are all college-scoped, and a college reads only its own
-- students. Two things were not, and are fixed here. Rule 1 and rule 2 live in
-- the create-student-users edge function.
-- ============================================================================


-- ── where an account came from is now a fact, not a guess ───────────────
-- source was null on every row, so the only way to tell a self-signup from an
-- imported student was to notice whether college_id happened to be set — which
-- stops being true the moment rule 1 links one of them.
alter table public.student_profiles
  alter column source set default 'self_signup';

update public.student_profiles
   set source = case when college_id is null then 'self_signup' else 'csv_import' end
 where source is null;


-- ── the leaderboard put strangers in one table ──────────────────────────
-- It ranked everyone whose college matched yours, and in SQL a null college
-- matches another null college: three unrelated self-signed-up students from
-- three different cities were being ranked against each other as though they
-- were a cohort.
--
-- A student with no college has no cohort to be ranked in. An empty board is
-- the honest answer; a meaningless one is not.
create or replace function public.get_leaderboard(_limit integer default 100)
returns table (id uuid, full_name text, profile_photo_url text, total_xp integer,
               trust_score numeric, rank bigint)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with me as (
    select college_id from public.student_profiles where id = (select auth.uid())
  )
  select p.id, p.full_name, p.profile_photo_url, p.total_xp, p.trust_score,
         rank() over (order by p.total_xp desc, p.created_at)
  from public.student_profiles p
  where p.status = 'active'
    and (
      (select public.is_admin())
      or (p.college_id is not null
          and p.college_id = (select college_id from me))
    )
  order by p.total_xp desc, p.created_at
  limit greatest(_limit, 1);
$fn$;

revoke all on function public.get_leaderboard(integer) from public, anon;
grant execute on function public.get_leaderboard(integer) to authenticated;
