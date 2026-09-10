-- NOTE ON THE FILE NAME: version 20260910173334, as recorded by apply_migration
-- in the live database. Superseded within minutes by stage 65b below - kept
-- because it ran, and the folder records what ran.
--
-- One number instead of a thousand rows.
--
-- useStudentProfile called get_leaderboard(1000) and searched the result for
-- the signed-in student. Two problems: it moved up to a thousand rows to every
-- dashboard to read one integer, and past a thousand active students anyone
-- below that cut simply was not in the list, so their rank silently came back
-- as 0. The second is a wrong answer, not a slow one.
create or replace function public.my_rank()
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with me as (
    select total_xp, created_at
      from public.student_profiles
     where id = (select auth.uid())
       and status = 'active'
  )
  select case
           when not exists (select 1 from me) then 0::bigint
           else 1 + (
             select count(*)
               from public.student_profiles p, me
              where p.status = 'active'
                and (p.total_xp > me.total_xp
                     or (p.total_xp = me.total_xp and p.created_at < me.created_at))
           )
         end;
$fn$;

revoke all on function public.my_rank() from public, anon;
grant execute on function public.my_rank() to authenticated;

create index if not exists student_profiles_active_xp_idx
  on public.student_profiles (total_xp desc, created_at)
  where status = 'active';
