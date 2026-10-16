-- 118: "Active day" points are counted.
--
-- squad_scoring_rules has had an 'active_day' rule (3 points) since stage 16:
-- "Counted once per day regardless of how much was done". run_squad_week()
-- scores by joining each activity event to the rule of the same name, and
-- 'active_day' is not an event type (student_activity_events only allows real
-- actions), so the rule never matched and nobody ever got those points. Found
-- by the 12-week season simulation on staging, 16 Oct 2026.
--
-- run_squad_week() now adds, per student per week, the rule's points times the
-- number of days (India time) on which the student did anything. Everything
-- else in the function is unchanged. Weeks already scored keep their points
-- until they are scored again.
begin;

create or replace function public.run_squad_week(_season_id uuid, _week integer default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  wk integer := coalesce(_week, greatest(1, public.season_week(_season_id) - 1));
  ranked integer := 0;
  played integer := 0;
begin
  -- individual scores for the week
  insert into public.student_weekly_scores
    (season_id, student_id, squad_id, week, points, breakdown)
  select _season_id, m.student_id, m.squad_id, wk,
         coalesce(sum(r.points), 0),
         coalesce(jsonb_object_agg(r.metric, r.n) filter (where r.metric is not null), '{}'::jsonb)
    from public.squad_members m
    join public.squads q on q.id = m.squad_id and q.season_id = _season_id
    left join lateral (
      select sr.metric, sr.points * count(*) as points, count(*) as n
        from public.student_activity_events e
        join lateral (
          -- college_id already lives on the event row, so this needs no join
          -- back to student_profiles. A college-specific row wins over the
          -- platform default for the same metric.
          select * from public.squad_scoring_rules sr2
           where sr2.metric = e.event_type
             and (sr2.college_id = e.college_id or sr2.college_id is null)
           order by sr2.college_id nulls last
           limit 1
        ) sr on true
       where e.student_id = m.student_id
         and e.occurred_at >= public.season_week_start(_season_id, wk)
         and e.occurred_at <  public.season_week_start(_season_id, wk) + interval '7 days'
       group by sr.metric, sr.points
      union all
      -- Active day: once per calendar day (India time) with any activity, however
      -- much was done that day. Its rule existed since stage 16, but 'active_day'
      -- is not an event type, so the per-event join above could never match it.
      select ad.metric, ad.points * d.n, d.n
        from (select count(distinct (e.occurred_at at time zone 'Asia/Kolkata')::date)::int as n
                from public.student_activity_events e
               where e.student_id = m.student_id
                 and e.occurred_at >= public.season_week_start(_season_id, wk)
                 and e.occurred_at <  public.season_week_start(_season_id, wk) + interval '7 days') d
        join lateral (
          select sr3.metric, sr3.points from public.squad_scoring_rules sr3
           where sr3.metric = 'active_day'
             and (sr3.college_id = q.college_id or sr3.college_id is null)
           order by sr3.college_id nulls last
           limit 1
        ) ad on true
       where d.n > 0
    ) r on true
   where m.left_at is null
   group by m.student_id, m.squad_id
  on conflict (season_id, student_id, week)
    do update set points = excluded.points, breakdown = excluded.breakdown;

  -- squad totals for the week
  insert into public.squad_weekly_scores
    (season_id, squad_id, week, points, active_members, total_members)
  select _season_id, q.id, wk,
         coalesce((select sum(s.points) from public.student_weekly_scores s
                    where s.season_id = _season_id and s.squad_id = q.id and s.week = wk), 0),
         coalesce((select count(*) from public.student_weekly_scores s
                    where s.season_id = _season_id and s.squad_id = q.id and s.week = wk and s.points > 0), 0),
         coalesce((select count(*) from public.squad_members m
                    where m.squad_id = q.id and m.left_at is null), 0)
    from public.squads q
   where q.season_id = _season_id
  on conflict (season_id, squad_id, week)
    do update set points = excluded.points,
                  active_members = excluded.active_members,
                  total_members = excluded.total_members,
                  computed_at = now();

  with r as (
    select squad_id, rank() over (order by points desc, squad_id) as pos
      from public.squad_weekly_scores
     where season_id = _season_id and week = wk
  )
  update public.squad_weekly_scores w set rank = r.pos
    from r where w.squad_id = r.squad_id and w.season_id = _season_id and w.week = wk;

  -- season points are every week so far, not just this one
  update public.squads q
     set previous_rank = q.rank,
         points = coalesce((select sum(points) from public.squad_weekly_scores
                             where season_id = _season_id and squad_id = q.id), 0)
   where q.season_id = _season_id;

  select count(*) into ranked from public.squads where season_id = _season_id;

  played := public.settle_round(_season_id, wk);
  perform public.recount_season(_season_id);

  perform public.write_audit('SQUAD_WEEK_SCORED', 'squad_weekly_scores', _season_id,
    null, jsonb_build_object('week', wk, 'squads', ranked, 'matches_settled', played),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'week', wk, 'squads_scored', ranked,
                            'matches_settled', played);
end $fn$;

revoke all on function public.run_squad_week(uuid, integer) from public, anon, authenticated;
grant execute on function public.run_squad_week(uuid, integer) to service_role;

do $$
begin
  if position('''active_day''' in pg_get_functiondef('public.run_squad_week(uuid,integer)'::regprocedure)) = 0 then
    raise exception '118 self-check: run_squad_week does not count active days';
  end if;
  if has_function_privilege('authenticated', 'public.run_squad_week(uuid,integer)', 'EXECUTE') then
    raise exception '118 self-check: run_squad_week is callable by authenticated';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
