-- ============================================================================
-- Stage 24, second half — the two Insights the college never had.
--
-- §11 lists six insights. Branch activity, skill gaps, participation, squad
-- trends, risk signals and season results. Four were built. Branch activity had
-- no reader at all, and squad trend existed only as two numbers that nothing
-- ever subtracted — the improving-or-declining question the screen is for.
--
-- Season results is the one that mattered most: close_season has been recording
-- a champion, a runner-up and a third since the last stage, and nothing in the
-- product displayed any of them.
-- ============================================================================

create or replace function public.tpo_college_report()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare
  cid uuid := coalesce(public.my_college_id(), public.viewer_college_id());
  branches jsonb;
  trends   jsonb;
  seasons  jsonb;
begin
  if cid is null then
    return jsonb_build_object('error', 'Only a college can read this report.');
  end if;

  -- last_active rather than a scan of the events table: the same answer, and
  -- the events table is the one with eighteen million rows a year in it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'branch', b.branch, 'students', b.students,
           'active_week', b.active_week, 'in_squads', b.in_squads)
         order by b.students desc), '[]'::jsonb)
    into branches
    from (
      select coalesce(nullif(trim(p.branch), ''), 'Not set') as branch,
             count(*) as students,
             count(*) filter (where p.last_active > now() - interval '7 days') as active_week,
             count(*) filter (where exists (
               select 1 from public.squad_members m
                where m.student_id = p.id and m.left_at is null)) as in_squads
        from public.student_profiles p
       where p.college_id = cid
       group by 1
    ) b;

  select coalesce(jsonb_agg(jsonb_build_object(
           'squad_id', t.squad_id, 'squad', t.name, 'week', t.week,
           'points', t.points, 'change', t.change)
         order by t.change desc nulls last), '[]'::jsonb)
    into trends
    from (
      select w.squad_id, s.name, w.week, w.points,
             (w.points - lag(w.points) over (partition by w.squad_id order by w.week)) as change,
             row_number() over (partition by w.squad_id order by w.week desc) as rn
        from public.squad_weekly_scores w
        join public.squads s on s.id = w.squad_id
       where s.college_id = cid and s.archived_at is null
    ) t
   where t.rn = 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'status', s.status,
           'is_current', s.is_current, 'starts_on', s.starts_on, 'ends_on', s.ends_on,
           'completed_at', s.completed_at,
           'champion', c1.name, 'runner_up', c2.name, 'third', c3.name,
           'squads', (select count(*) from public.squads q where q.season_id = s.id))
         order by s.starts_on desc), '[]'::jsonb)
    into seasons
    from public.seasons s
    left join public.squads c1 on c1.id = s.champion_squad_id
    left join public.squads c2 on c2.id = s.runner_up_squad_id
    left join public.squads c3 on c3.id = s.third_squad_id
   where s.college_id = cid;

  return jsonb_build_object('branches', branches, 'squad_trends', trends, 'seasons', seasons);
end $fn$;

revoke all on function public.tpo_college_report() from public, anon;
grant execute on function public.tpo_college_report() to authenticated;
