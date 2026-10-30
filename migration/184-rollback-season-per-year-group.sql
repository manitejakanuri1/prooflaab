-- Rollback of 184: back to one season per college (179 week-1 joining, 182 carry-over by school year).
-- Seasons opened by 184 stay as rows; their extra columns are dropped.
begin;
drop function if exists public.tpo_season_options(text[], boolean, boolean);
drop function if exists public.tpo_pick_year_group(integer);
drop function if exists public.tpo_year_groups();
drop function if exists public.in_season_gap(uuid);
drop function if exists public.generate_section_finals(uuid);
drop function if exists public.generate_section_knockout(uuid);
drop function if exists public.form_squads_in(uuid);
drop function if exists public.ensure_season(uuid, integer);
CREATE OR REPLACE FUNCTION public.ensure_season(_college_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare sid uuid; n integer; nm text;
begin
  if _college_id is null then return null; end if;
  select id into sid from public.seasons
   where college_id = _college_id and is_current
   order by starts_on desc limit 1;
  if sid is not null then return sid; end if;
  select count(*) into n from public.seasons where college_id = _college_id;
  nm := 'Season ' || (n + 1);
  insert into public.seasons (name, college_id, starts_on, ends_on,
                              is_current, planned_weeks, status)
  values (nm, _college_id, current_date, current_date + (12 * 7), true, 12, 'active')
  returning id into sid;
  perform public.write_audit('SEASON_OPENED', 'seasons', sid, null,
    jsonb_build_object('name', nm, 'planned_weeks', 12), _college_id);
  -- 182 (owner): the same squads carry on all school year; a new school year starts fresh.
  perform public.carry_over_squads(sid);
  return sid;
end $function$;
revoke all on function public.ensure_season(uuid) from public, anon, authenticated;
grant execute on function public.ensure_season(uuid) to service_role;
create or replace function public.carry_over_squads(_season_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  s record; prev record; q record; new_id uuid; carried integer := 0;
begin
  select * into s from public.seasons where id = _season_id;
  if s.id is null then return 0; end if;
  -- the college's last finished season
  select * into prev from public.seasons
   where college_id = s.college_id and id <> s.id and status = 'complete' and completed_at is not null
   order by completed_at desc limit 1;
  if prev.id is null or public.school_year(prev.starts_on) <> public.school_year(s.starts_on) then return 0; end if;
  -- already carried (or squads already made) for this season
  if exists (select 1 from public.squads where season_id = s.id and archived_at is null) then return 0; end if;

  perform set_config('app.system_write', 'on', true);
  for q in select * from public.squads where season_id = prev.id order by name loop
    insert into public.squads (name, college_id, season_id, cohort, max_members)
    values (q.name, q.college_id, s.id, q.cohort, q.max_members)
    returning id into new_id;
    -- the members the season let go when it closed (close_season sets left_at = completed_at)
    insert into public.squad_members (squad_id, student_id, role, membership_type, joined_at)
    select new_id, m.student_id, m.role, m.membership_type, now()
      from public.squad_members m
      join public.student_profiles p on p.id = m.student_id
     where m.squad_id = q.id
       and m.left_at = prev.completed_at
       and p.college_id = s.college_id
       and p.onboarding_status <> 'blocked'
       and p.cohort is not distinct from q.cohort
       and not exists (select 1 from public.squad_members x where x.student_id = m.student_id and x.left_at is null);
    carried := carried + 1;
  end loop;
  -- a squad nobody came back to is not kept
  delete from public.squads n
   where n.season_id = s.id
     and not exists (select 1 from public.squad_members m where m.squad_id = n.id and m.left_at is null);
  perform set_config('app.system_write', 'off', true);

  perform public.write_audit('SQUADS_CARRIED_OVER', 'squads', s.id, null,
    jsonb_build_object('from_season', prev.id,
                       'squads', (select count(*) from public.squads where season_id = s.id)), s.college_id);
  return (select count(*)::int from public.squads where season_id = s.id);
end $fn$;
CREATE OR REPLACE FUNCTION public.advance_season(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare wk integer; ph text; did text := 'nothing';
begin
  wk := public.season_week(_season_id);
  ph := public.season_phase(_season_id, wk);
  if ph = 'league' then
    if not exists (select 1 from public.squad_matches
                    where season_id = _season_id and stage = 'league') then
      perform public.generate_cohort_league(_season_id, false);
      did := 'league fixtures created';
    end if;
  elsif ph = 'championship' then
    if not exists (select 1 from public.squad_matches
                    where season_id = _season_id and stage = 'championship') then
      perform public.qualify_squads(_season_id);
      perform public.generate_championship(_season_id);
      did := 'qualification decided and championship created';
    end if;
  elsif ph = 'seeding' then
    if exists (select 1 from public.squads where season_id = _season_id and qualified) then
      perform public.seed_championship(_season_id);
      did := 'championship seeded';
    end if;
  elsif ph = 'knockout' then
    if not exists (select 1 from public.squad_matches
                    where season_id = _season_id and stage = 'knockout') then
      perform public.generate_knockout(_season_id);
      did := 'knockout created';
    end if;
  elsif ph = 'final' then
    if not exists (select 1 from public.squad_matches
                    where season_id = _season_id and stage = 'final') then
      perform public.generate_final(_season_id);
      did := 'final created';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'week', wk, 'phase', ph, 'did', did);
end $function$;
CREATE OR REPLACE FUNCTION public.my_last_season_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select s.id from public.seasons s
   where s.college_id = coalesce(public.my_college_id(),
                                 (select p.college_id from public.student_profiles p where p.id = (select auth.uid())))
   order by s.starts_on desc limit 1;
$function$;
CREATE OR REPLACE FUNCTION public.my_season_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select s.id
    from public.seasons s
   where s.is_current
     and s.college_id = coalesce(
           public.my_college_id(),
           (select p.college_id from public.student_profiles p where p.id = (select auth.uid())))
   order by s.starts_on desc
   limit 1;
$function$;
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
CREATE OR REPLACE FUNCTION public.season_plan(_season_id uuid)
 RETURNS TABLE(week integer, phase text, label text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with s as (
    select greatest(coalesce(planned_weeks, 12), 6) as weeks
      from public.seasons where id = _season_id
  ), split as (
    select weeks,
           2 as foundation,
           ceil((weeks - 5) * 4.0 / 7.0)::int as league,
           (weeks - 5) - ceil((weeks - 5) * 4.0 / 7.0)::int as championship
      from s
  )
  select w.week,
         case
           when w.week <= split.foundation then 'foundation'
           when w.week <= split.foundation + split.league then 'league'
           when w.week <= split.foundation + split.league + split.championship then 'championship'
           when w.week = split.weeks - 2 then 'seeding'
           when w.week = split.weeks - 1 then 'knockout'
           else 'final'
         end as phase,
         case
           when w.week <= split.foundation then 'Foundation, calibration and squad formation'
           when w.week <= split.foundation + split.league then 'Cohort league - round robin'
           when w.week <= split.foundation + split.league + split.championship then 'Inter-cohort championship'
           when w.week = split.weeks - 2 then 'Qualification and seeding'
           when w.week = split.weeks - 1 then 'Championship stage'
           else 'Grand final and season close'
         end as label
    from split, generate_series(1, split.weeks) as w(week);
$function$;
CREATE OR REPLACE FUNCTION public.form_all_colleges()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c record; made integer := 0; placed integer := 0; failed integer := 0; first_error text; r jsonb;
begin
  for c in
    -- 160 (MF-016): also a college whose last season has finished, so form_squads -> ensure_season opens the next.
    select distinct s.college_id from public.seasons s
     where s.college_id is not null
       and ((s.is_current and s.status = 'active')
            or (s.status = 'complete'
                and not exists (select 1 from public.seasons x where x.college_id = s.college_id and x.is_current)))
  loop
    begin
      r := public.form_squads(c.college_id);
      made   := made   + coalesce((r->>'squads_created')::int, 0);
      placed := placed + coalesce((r->>'students_placed')::int, 0);
    exception when others then
      -- One college's problem must not stop every other college's morning, but it must be seen (108).
      failed := failed + 1;
      first_error := coalesce(first_error, c.college_id || ': ' || left(sqlerrm, 200));
      raise notice 'squad formation failed for %: %', c.college_id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'squads_created', made, 'students_placed', placed,
                            'colleges_failed', failed, 'first_error', first_error,
                            'status', case when failed > 0 then 'partial_failure' else 'success' end,
                            'ran_at', now());
end $function$;
CREATE OR REPLACE FUNCTION public.tpo_create_squad(_name text, _cohort text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cid uuid := public.my_college_id();
  sid uuid; new_id uuid; nm text := nullif(trim(coalesce(_name, '')), '');
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can create its own squads';
  end if;
  if nm is null then raise exception 'a squad needs a name'; end if;
  sid := public.ensure_season(cid);
  if sid is null then raise exception 'no season is running for this college'; end if;
  if exists (select 1 from public.squads
              where season_id = sid and archived_at is null and lower(name) = lower(nm)) then
    raise exception 'there is already a squad called % this season', nm;
  end if;
  insert into public.squads (name, college_id, season_id, cohort, max_members)
  values (nm, cid, sid, nullif(trim(coalesce(_cohort, '')), ''), 12)
  returning id into new_id;
  perform public.write_audit('SQUAD_CREATED', 'squads', new_id, null,
    jsonb_build_object('name', nm, 'cohort', _cohort), cid);
  return jsonb_build_object('ok', true, 'squad_id', new_id, 'name', nm,
                            'cohort', _cohort, 'max_members', 12);
end $function$;
CREATE OR REPLACE FUNCTION public.tpo_generate_fixtures(_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cid uuid := public.my_college_id(); sid uuid;
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can generate its own fixtures';
  end if;
  select id into sid from public.seasons
   where college_id = cid and is_current order by starts_on desc limit 1;
  if sid is null then raise exception 'no season is running for this college'; end if;
  return public.generate_cohort_league(sid, _force);
end $function$;
CREATE OR REPLACE FUNCTION public.tpo_run_week(_week integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cid uuid := public.my_college_id(); sid uuid;
begin
  if cid is null and not public.is_admin() then
    raise exception 'only a college can score its own season'; end if;
  select id into sid from public.seasons
   where college_id = cid and is_current order by starts_on desc limit 1;
  if sid is null then raise exception 'no season is running'; end if;
  return public.run_squad_week(sid, _week);
end $function$;
CREATE OR REPLACE FUNCTION public.colleges_open_season()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public.ensure_season(new.id);
  return new;
end $function$;
CREATE OR REPLACE FUNCTION public.admin_squads(_college_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  if _college_id is null then
    return coalesce((
      select jsonb_agg(jsonb_build_object('college_id', c.id, 'college', c.name, 'season_starts', s.starts_on,
               'squads', (select count(*) from public.squads q where q.season_id = s.id and q.archived_at is null),
               'swaps', (select count(*) from public.squad_swaps w where w.season_id = s.id and w.status = 'done'))
               order by c.name)
        from public.seasons s join public.colleges c on c.id = s.college_id
       where s.is_current), '[]'::jsonb);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id, 'name', q.name, 'cohort', q.cohort, 'points', q.points, 'rank', q.rank,
             'max_members', q.max_members, 'is_locked', q.is_locked, 'code', public.squad_code_for(q.id),
             'swap_closes', public.squad_swap_closes(q.id),
             'members', coalesce((select jsonb_agg(jsonb_build_object('name', p.full_name, 'contribution', m.contribution,
                                                                      'joined_at', m.joined_at) order by p.full_name)
                                    from public.squad_members m join public.student_profiles p on p.id = m.student_id
                                   where m.squad_id = q.id and m.left_at is null), '[]'::jsonb))
           order by q.cohort nulls last, q.points desc, q.name)
      from public.squads q join public.seasons s on s.id = q.season_id
     where q.college_id = _college_id and s.is_current and q.archived_at is null), '[]'::jsonb);
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
CREATE OR REPLACE FUNCTION public.close_season(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  podium uuid[]; names text[];
  fin record; champ uuid; runner uuid; third uuid;
begin
  select * into fin from public.squad_matches
   where season_id = _season_id and stage = 'final' and status in ('played', 'no_activity')
   order by scheduled_at desc limit 1;
  if fin.id is not null then
    champ := coalesce(fin.winner_squad, case
      when coalesce(fin.home_points, 0) > coalesce(fin.away_points, 0) then fin.home_squad
      when coalesce(fin.away_points, 0) > coalesce(fin.home_points, 0) then fin.away_squad
      else (select id from public.squads where id in (fin.home_squad, fin.away_squad)
             order by seed nulls last, points desc limit 1)
    end);
    runner := case when champ = fin.home_squad then fin.away_squad else fin.home_squad end;
    -- Third: the semi-final losers, better seed first.
    select q.id into third
      from public.squad_matches m
      join public.squads q on q.id in (m.home_squad, m.away_squad)
     where m.season_id = _season_id and m.stage = 'knockout' and m.status in ('played', 'no_activity')
       and q.id not in (champ, runner)
     order by q.seed nulls last, q.points desc
     limit 1;
    podium := array[champ, runner, third];
  elsif exists (select 1 from public.squad_matches
                 where season_id = _season_id and stage = 'league' and status = 'played') then
    select array_agg(id order by points desc nulls last, name)
      into podium
      from public.squads where season_id = _season_id;
  else
    -- 174 (MF-053): no league match was ever played (for example a college with one squad): nobody is champion.
    podium := null;
  end if;
  select array_agg(q.name order by p.i) into names
    from unnest(podium) with ordinality p(id, i) join public.squads q on q.id = p.id;
  update public.seasons
     set status = 'complete', is_current = false, completed_at = now(),
         champion_squad_id  = podium[1],
         runner_up_squad_id = podium[2],
         third_squad_id     = podium[3]
   where id = _season_id;
  -- 160 (MF-016): the season lets its students go, so the next morning's formation can seat them again.
  update public.squad_members m set left_at = now()
    from public.squads q
   where q.id = m.squad_id and q.season_id = _season_id and m.left_at is null;
  update public.squads set archived_at = now()
   where season_id = _season_id and archived_at is null;
  perform public.write_audit('SEASON_CLOSED', 'seasons', _season_id, null,
    jsonb_build_object('champion', names[1], 'runner_up', names[2], 'third', names[3],
                       'decided_by', case when fin.id is not null then 'final' when podium is null then 'no_league' else 'points' end),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'champion', names[1],
                            'runner_up', names[2], 'third', names[3],
                            'decided_by', case when fin.id is not null then 'final' when podium is null then 'no_league' else 'points' end);
end $function$;
CREATE OR REPLACE FUNCTION public.create_lot_for(_student_id uuid, _for_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
declare
  d    date := coalesce(_for_date, current_date);
  pick jsonb;
  scid uuid;
  cand uuid;
  tpl  record;
  n    integer;
  tid  uuid;
  cur  record;
begin
  select t.id, t.source_content_id into cur
    from public.tasks t where t.student_id = _student_id and t.lot_date = d limit 1;
  if cur.id is not null then
    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'source_content_id', cur.source_content_id,
                              'needs_writer', public.lot_needs_writer(cur.id));
  end if;
  if public.lot_day_kind(d) = 'rest' then
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
      'reason', 'rest day', 'needs_writer', false);
  end if;
  pick := public.next_lot_pick(_student_id, d);
  scid := (pick->>'source_content_id')::uuid;
  cand := (pick->>'candidate_id')::uuid;
  if scid is null then
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
      'reason', 'no content available', 'needs_writer', false);
  end if;
  if cand is not null then
    select t.* into tpl from public.lot_templates t
      join public.lot_candidates c on c.lot_template_id = t.id where c.id = cand;
  end if;
  if tpl is null then
    select * into tpl from public.lot_templates where source_content_id = scid;
  end if;
  if tpl is null then
    perform public.seed_lot_template(scid);
    select * into tpl from public.lot_templates where source_content_id = scid;
    cand := (select c.id from public.lot_candidates c where c.lot_template_id = tpl.id);
  end if;
  if tpl is null then
    return jsonb_build_object('ok', false, 'reason', 'no template', 'needs_writer', false);
  end if;
  select count(*) + 1 into n from public.tasks where student_id = _student_id and lot_date is not null;
  insert into public.tasks
    (student_id, title, description, code_sample, source_jd, difficulty,
     estimate_minutes, lot_category, lot_number, lot_date, source_content_id,
     status, visibility, due_date, is_ai_generated, created_by_type, source,
     xp_reward, sandbox_config_id, rubric_config_id, lot_candidate_id, lot_selection)
  values
    (_student_id, tpl.title, tpl.scenario, tpl.code_sample, tpl.source_jd, tpl.difficulty,
     tpl.estimate_minutes, tpl.lot_category, n, d, scid,
     'pending', 'private', (d + 1)::timestamptz - interval '1 second',
     tpl.origin = 'ai', 'system', 'daily_lot',
     tpl.xp_reward, tpl.sandbox_config_id, tpl.rubric_config_id, cand, pick)
  on conflict (student_id, lot_date) where lot_date is not null do nothing
  returning id into tid;
  if tid is null then
    select t.id, t.source_content_id into cur from public.tasks t
     where t.student_id = _student_id and t.lot_date = d limit 1;
    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'reason', 'another request created it first',
                              'source_content_id', cur.source_content_id,
                              'needs_writer', public.lot_needs_writer(cur.id));
  end if;
  return jsonb_build_object('ok', true, 'task_id', tid, 'created', true, 'source_content_id', scid,
                            'rule', pick->>'rule', 'needs_writer', tpl.origin = 'seed');
end $function$;
CREATE OR REPLACE FUNCTION public.form_squads(_college_id uuid, _season_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  sid uuid; theme text;
  created integer := 0; placed integer := 0; filled integer;
  co record; n integer; k integer; existing integer; i integer;
  squad_ids uuid[]; new_id uuid; stu record; target uuid;
  pos integer; cycle integer; idx integer;
begin
  -- 108: one formation per college at a time (nightly job, import and the Generate button can overlap).
  perform pg_advisory_xact_lock(hashtext('prooflab.squads'), hashtext(_college_id::text));
  sid := coalesce(_season_id, public.ensure_season(_college_id));
  if sid is null then raise exception 'no season is running for this college'; end if;
  -- 179 (owner, 30 Oct 2026): new students join a squad only in week 1 of a season. From week 2 they wait in
  -- Reserve for the next season (Daily Lots, roadmap and their own points carry on). A season with no squads
  -- yet (a college that joins mid-season) still gets its first squads. 175's rule (no one after the league)
  -- is kept inside this one.
  if exists (select 1 from public.squad_matches where season_id = sid and stage <> 'league')
     or (public.season_week(sid) > 1
         and exists (select 1 from public.squads where season_id = sid and archived_at is null)) then
    return jsonb_build_object(
      'ok', true, 'squads_created', 0, 'students_placed', 0, 'league_over', true,
      'reserve', (select count(*) from public.student_profiles p
                   where p.college_id = _college_id
                     and p.onboarding_status <> 'blocked'
                     and not exists (select 1 from public.squad_members m
                                      where m.student_id = p.id and m.left_at is null)));
  end if;
  for co in
    select coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL') as cohort,
           count(*) as students
      from public.student_profiles p
     where p.college_id = _college_id
       and p.onboarding_status <> 'blocked'
       and not exists (select 1 from public.squad_members m
                        where m.student_id = p.id and m.left_at is null)
     group by 1
     order by 1
  loop
    n := co.students;
    -- NEW: seat students in squads that already exist for this section first,
    -- emptiest squad first, up to eleven (the twelfth seat stays free).
    filled := 0;
    for stu in
      select p.id
        from public.student_profiles p
       where p.college_id = _college_id
         and coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL') = co.cohort
         and p.onboarding_status <> 'blocked'
         and not exists (select 1 from public.squad_members m
                          where m.student_id = p.id and m.left_at is null)
       order by coalesce(p.total_xp, 0) desc,
                (select count(distinct ts.task_id) from public.task_submissions ts
                  where ts.student_id = p.id and ts.status = 'passed'
                    and ts.created_at >= now() - interval '30 days') desc,
                p.roll_number nulls last, p.full_name
    loop
      select s.id into target
        from public.squads s
       where s.season_id = sid and s.archived_at is null
         and s.college_id = _college_id and not s.is_locked -- 108: a locked squad is the college's to fill
         and coalesce(s.cohort, 'GENERAL') = co.cohort
         and (select count(*) from public.squad_members m
               where m.squad_id = s.id and m.left_at is null) < least(11, s.max_members)
       order by (select count(*) from public.squad_members m
                  where m.squad_id = s.id and m.left_at is null), s.created_at
       limit 1;
      exit when target is null;
      begin -- 108: placed meanwhile (for example by Assign): skip this student, never fail the run
        insert into public.squad_members (squad_id, student_id, joined_at)
        values (target, stu.id, now());
      exception when unique_violation then
        continue;
      end;
      placed := placed + 1;
      filled := filled + 1;
    end loop;
    n := n - filled;
    -- From here on: stage54, unchanged. Whole elevens only; fewer than eleven
    -- left means no new squad, they wait for the college to decide.
    k := n / 11;
    continue when k < 1;
    select t.theme into theme
      from public.squad_name_themes t
     where t.branch = split_part(co.cohort, '-', 1)
       and (t.college_id = _college_id or t.college_id is null)
     order by t.college_id nulls last
     limit 1;
    if theme is null then
      select t.theme into theme
        from public.squad_name_themes t
       where t.branch = '*' and (t.college_id = _college_id or t.college_id is null)
       order by t.college_id nulls last
       limit 1;
    end if;
    theme := coalesce(theme, 'Squad');
    select count(*) into existing
      from public.squads s
     where s.season_id = sid and s.archived_at is null
       and coalesce(s.cohort, 'GENERAL') = co.cohort;
    squad_ids := '{}';
    for i in (existing + 1)..(existing + k) loop
      insert into public.squads (name, college_id, season_id, cohort, max_members)
      values (co.cohort || ' ' || theme || ' ' || i, _college_id, sid, co.cohort, 12)
      returning id into new_id;
      squad_ids := squad_ids || new_id;
      created := created + 1;
    end loop;
    pos := 0;
    for stu in
      select p.id
        from public.student_profiles p
       where p.college_id = _college_id
         and coalesce(nullif(trim(p.cohort), ''), nullif(trim(p.branch), ''), 'GENERAL') = co.cohort
         and p.onboarding_status <> 'blocked'
         and not exists (select 1 from public.squad_members m
                          where m.student_id = p.id and m.left_at is null)
       order by coalesce(p.total_xp, 0) desc,
                (select count(distinct ts.task_id) from public.task_submissions ts
                  where ts.student_id = p.id and ts.status = 'passed'
                    and ts.created_at >= now() - interval '30 days') desc,
                p.roll_number nulls last, p.full_name
       limit k * 11
    loop
      cycle := pos / k;
      idx   := pos % k;
      if cycle % 2 = 1 then idx := k - 1 - idx; end if;
      insert into public.squad_members (squad_id, student_id, joined_at)
      values (squad_ids[idx + 1], stu.id, now());
      placed := placed + 1;
      pos := pos + 1;
    end loop;
  end loop;
  perform public.write_audit('SQUADS_FORMED', 'squads', _college_id, null,
    jsonb_build_object('squads_created', created, 'students_placed', placed), _college_id);
  return jsonb_build_object(
    'ok', true, 'squads_created', created, 'students_placed', placed,
    'cohorts', (select count(distinct cohort) from public.squads
                 where season_id = sid and archived_at is null),
    'reserve', (select count(*) from public.student_profiles p
                 where p.college_id = _college_id
                   and p.onboarding_status <> 'blocked'
                   and not exists (select 1 from public.squad_members m
                                    where m.student_id = p.id and m.left_at is null)));
end $function$;

drop function if exists public.my_year_group();
drop function if exists public.match_winner(uuid);
drop function if exists public.season_gap(uuid);
drop table if exists public.season_champions;
drop index if exists public.seasons_one_current_per_year_group;
alter table public.colleges drop column if exists viewing_year_group;
alter table public.squads drop column if exists bracket;
alter table public.seasons drop column if exists cross_sections;
alter table public.seasons drop column if exists fresh_squads_next;
alter table public.seasons drop column if exists plan_version;
alter table public.seasons drop column if exists year_group;
notify pgrst, 'reload schema';
commit;
