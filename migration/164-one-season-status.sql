-- 164 (MF-008): one season status for every screen.
--   my_season_status: adds 'state' = active / complete / none. When the last season has finished it returns
--   that season, its champion, runner-up and third, and when the next season opens (the 05:35 IST squad job,
--   migration 160 opens it). Screens read this instead of guessing from squads.
--   tpo_home: "leader" comes only from the running season's squads (after the season ends: none).
-- Rollback: migration/164-rollback-one-season-status.sql
begin;

CREATE OR REPLACE FUNCTION public.my_season_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare sid uuid := public.my_season_id(); s record; wk integer; last record; nxt timestamptz;
begin
  if sid is null then
    -- 164 (MF-008): one status for every screen - 'active', 'complete' (last season finished, champion and
    -- podium, and when the next season opens: the 05:35 IST squad job) or 'none'.
    select x.* into last from public.seasons x
     where x.college_id = coalesce(public.my_college_id(),
                                   (select p.college_id from public.student_profiles p where p.id = (select auth.uid())))
     order by x.starts_on desc, x.completed_at desc nulls last, x.created_at desc limit 1;
    if last.id is null or last.status is distinct from 'complete' then
      return jsonb_build_object('season', null, 'state', 'none');
    end if;
    nxt := (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '5 hours 35 minutes') at time zone 'Asia/Kolkata';
    if nxt <= now() then nxt := nxt + interval '1 day'; end if;
    return jsonb_build_object(
      'season', null,
      'state', 'complete',
      'last_season', jsonb_build_object(
        'id', last.id, 'name', last.name, 'completed_at', last.completed_at,
        'champion',  (select q.name from public.squads q where q.id = last.champion_squad_id),
        'runner_up', (select q.name from public.squads q where q.id = last.runner_up_squad_id),
        'third',     (select q.name from public.squads q where q.id = last.third_squad_id)),
      'next_season_name', 'Season ' || ((select count(*) from public.seasons x where x.college_id = last.college_id) + 1),
      'next_season_at', nxt);
  end if;
  select * into s from public.seasons where id = sid;
  wk := public.season_week(sid);
  return jsonb_build_object(
    'state',            'active',
    'season_id',        sid,
    'name',             s.name,
    'status',           s.status,
    'starts_on',        s.starts_on,
    'planned_weeks',    s.planned_weeks,
    'week',             wk,
    'phase',            public.season_phase(sid, wk),
    'label',            (select label from public.season_plan(sid) where week = wk),
    'league_last_week', public.season_league_last_week(sid),
    'plan',             (select jsonb_agg(jsonb_build_object('week', week, 'phase', phase, 'label', label)
                                          order by week) from public.season_plan(sid)),
    'squads',           (select count(*) from public.squads
                          where season_id = sid and archived_at is null),
    'cohorts',          (select count(distinct coalesce(cohort, 'GENERAL')) from public.squads
                          where season_id = sid and archived_at is null),
    'qualified',        (select count(*) from public.squads
                          where season_id = sid and qualified),
    'decided',          exists (select 1 from public.squads
                                 where season_id = sid and qualified is not null)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.tpo_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cid uuid := public.my_college_id();
  season record; result jsonb;
  attention_rows jsonb;
begin
  if cid is null then return jsonb_build_object('error','not a college account'); end if;
  select s.id, s.name, s.planned_weeks, public.season_week(s.id) as week
    into season from public.seasons s
   where s.college_id = cid and s.is_current order by s.starts_on desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'full_name', a.full_name, 'reason_codes', a.reason_codes)), '[]'::jsonb)
    into attention_rows
    from public.tpo_attention() a;
  select jsonb_build_object(
    'students', (select count(*) from public.student_profiles where college_id = cid),
    'active_this_week', (select count(distinct student_id) from public.student_activity_events
       where college_id = cid and occurred_at >= now() - interval '7 days'),
    'active_today', (select count(distinct student_id) from public.student_activity_events
       where college_id = cid and occurred_at >= current_date),
    'needs_attention', jsonb_array_length(attention_rows),
    'squads', (select count(*) from public.squads where college_id = cid),
    'reserves', (select count(*) from public.student_profiles p
       where p.college_id = cid
         and not exists (select 1 from public.squad_members m
                          where m.student_id = p.id and m.left_at is null)),
    'season', case when season.id is null then null else jsonb_build_object(
        'id', season.id, 'name', season.name,
        'week', season.week, 'planned_weeks', season.planned_weeks) end,
    'leader', (select jsonb_build_object('id', q.id, 'name', q.name, 'points', q.points)
        -- 164 (MF-008): only the running season's squads lead; after a season ends there is no leader.
        from public.squads q where q.college_id = cid and q.season_id = season.id order by q.points desc nulls last limit 1),
    'attention_breakdown', (select coalesce(jsonb_agg(t order by t.students desc), '[]'::jsonb) from (
        select code as reason_code,
               case code when 'inactive'    then 'quiet for over a week'
                         when 'onboarding'  then 'have not finished onboarding'
                         when 'missed_lots' then 'missed this week''s Lot'
                         else code end as reason,
               count(*) as students,
               -- Only enough names to show. Ten thousand students behind one
               -- line would have shipped a megabyte of JSON to render "and
               -- 7,496 more".
               (array_agg(nm order by nm))[1:5] as who
          from (select r ->> 'full_name' as nm,
                       jsonb_array_elements_text(r -> 'reason_codes') as code
                  from jsonb_array_elements(attention_rows) r) x
         group by code) t)
  ) into result;
  return result;
end $function$;

do $$
begin
  if pg_get_functiondef('public.my_season_status()'::regprocedure) !~ '''complete''' then
    raise exception '164: season status has no complete state';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
