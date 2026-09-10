-- NOTE ON THE FILE NAME: version 20260910173433, as recorded by apply_migration.
--
-- Correcting stage 65 before anything uses it.
--
-- The version applied a moment earlier ranked a student against the whole
-- platform. The live get_leaderboard does not: a later migration re-scoped it so
-- a student sees only their own college, and an admin sees everything. Ranking
-- against a different population than the list the student is looking at would
-- put a number on screen that contradicts the rows beneath it.
--
-- Worth recording how that was missed: the migration FILE for get_leaderboard
-- still shows the old platform-wide body. The deployed function differs. The
-- database was the thing that had to be read, not the folder.
--
-- This mirrors the deployed get_leaderboard exactly - same population, same
-- ordering (total_xp desc, created_at) - expressed as "how many are strictly
-- ahead of me, plus one". A student with no college_id sees an empty
-- leaderboard there, so their rank is 0 here rather than 1.
create or replace function public.my_rank()
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with me as (
    select total_xp, created_at, college_id
      from public.student_profiles
     where id = (select auth.uid())
       and status = 'active'
  )
  select case
           when not exists (select 1 from me) then 0::bigint
           when (select public.is_admin()) then
             1 + (select count(*)
                    from public.student_profiles p, me
                   where p.status = 'active'
                     and (p.total_xp > me.total_xp
                          or (p.total_xp = me.total_xp and p.created_at < me.created_at)))
           when (select college_id from me) is null then 0::bigint
           else
             1 + (select count(*)
                    from public.student_profiles p, me
                   where p.status = 'active'
                     and p.college_id is not null
                     and p.college_id = me.college_id
                     and (p.total_xp > me.total_xp
                          or (p.total_xp = me.total_xp and p.created_at < me.created_at)))
         end;
$fn$;

revoke all on function public.my_rank() from public, anon;
grant execute on function public.my_rank() to authenticated;

-- Supports both branches: the college filter and the ordering.
create index if not exists student_profiles_active_college_xp_idx
  on public.student_profiles (college_id, total_xp desc, created_at)
  where status = 'active';
