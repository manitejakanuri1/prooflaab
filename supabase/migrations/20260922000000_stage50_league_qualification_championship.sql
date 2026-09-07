-- ============================================================================
-- Stage 50 — the competition the blueprint describes, in five stages.
--
-- Until now a season was one flat round robin across every squad in a college,
-- running for every planned week. The blueprint asks for something narrower and
-- then wider:
--
--     league        weeks 3-6    round robin INSIDE each cohort
--     qualification end of league  top two squads per cohort go through
--     championship  weeks 7-9    round robin among the qualified, cross-cohort
--     seeding       week 10      the qualified are ranked and seeded
--     knockout      week 11      1v4 and 2v3
--     final         week 12      the two winners
--
-- Section 11 of the blueprint is the reason for the shape: with ~67 squads in a
-- college, one round robin is far too many fixtures for twelve weeks. A cohort
-- league is small enough to finish, and only its winners meet across cohorts.
--
-- SECTION 13, THE RULE THAT MATTERS MOST. Failing to qualify ends a squad's
-- championship race and nothing else. There is no elimination of students here:
-- daily Lots, individual scores, the individual leaderboard and every
-- individual award carry on untouched for the rest of the season. Nothing in
-- this migration reads `qualified` when deciding what work a student receives.
--
-- One scheduler, schedule_round_robin(), is shared by the league and the
-- championship — the circle method, a null placeholder for an odd count (that
-- is the BYE), and home/away swapping on the second cycle. settle_round() and
-- run_squad_week() are untouched and keep working for every stage, because
-- every fixture in every stage still carries round_number = the week it is
-- played in.
-- ============================================================================

alter table public.squad_matches add column if not exists stage  text not null default 'league';
alter table public.squad_matches add column if not exists cohort text;
alter table public.squads        add column if not exists qualified boolean;
alter table public.squads        add column if not exists seed integer;

alter table public.squad_matches drop constraint if exists squad_matches_stage_check;
alter table public.squad_matches add constraint squad_matches_stage_check
  check (stage in ('league', 'championship', 'knockout', 'final'));

comment on column public.squad_matches.stage is
  'Which part of the season this fixture belongs to: league, championship, knockout or final.';
comment on column public.squad_matches.cohort is
  'Set on league fixtures only — the cohort whose league this fixture belongs to.';
comment on column public.squads.qualified is
  'Null until the league ends. True: through to the championship. False: championship race over, daily learning continues exactly as before.';
comment on column public.squads.seed is
  'Seeding position among the qualified squads, set in the seeding week.';

create index if not exists squad_matches_stage_idx on public.squad_matches (season_id, stage, round_number);

-- ------------------------------------------------------------- the scheduler

create or replace function public.schedule_round_robin(
  _season_id uuid,
  _squad_ids uuid[],
  _first_week integer,
  _last_week integer,
  _stage text,
  _cohort text default null
) returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  ids uuid[] := _squad_ids;
  n integer; rounds integer; created integer := 0;
  wk integer; r integer; cycle integer; step integer; i integer;
  rotated uuid[]; a uuid; b uuid; starts date;
begin
  if ids is null or array_length(ids, 1) < 2 then return 0; end if;
  if _last_week < _first_week then return 0; end if;

  select starts_on into starts from public.seasons where id = _season_id;

  -- An odd number of squads gets a null partner. Whoever draws it has a BYE
  -- that week: no fixture is written, and section 10 of the blueprint is
  -- explicit that a BYE costs the students nothing — they still get their Lots.
  if array_length(ids, 1) % 2 = 1 then ids := ids || array[null::uuid]; end if;
  n := array_length(ids, 1);
  rounds := n - 1;

  for wk in _first_week.._last_week loop
    r     := ((wk - _first_week) % rounds) + 1;
    cycle := ((wk - _first_week) / rounds) + 1;

    rotated := ids;
    for step in 1..(r - 1) loop
      rotated := array[rotated[1]] || (rotated[n:n] || rotated[2:n-1]);
    end loop;

    for i in 1..(n / 2) loop
      a := rotated[i];
      b := rotated[n + 1 - i];
      continue when a is null or b is null;

      insert into public.squad_matches
        (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage, cohort)
      values (_season_id, wk,
              case when cycle % 2 = 1 then a else b end,
              case when cycle % 2 = 1 then b else a end,
              (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours',
              'scheduled', _stage, _cohort);
      created := created + 1;
    end loop;
  end loop;

  return created;
end $function$;

-- ------------------------------------------------------------- cohort league

create or replace function public.generate_cohort_league(_season_id uuid, _force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  first_wk integer; last_wk integer; played integer;
  co record; ids uuid[]; created integer := 0; cohorts integer := 0;
begin
  select min(week) into first_wk from public.season_plan(_season_id) where phase = 'league';
  last_wk := public.season_league_last_week(_season_id);
  if first_wk is null then raise exception 'this season has no league weeks'; end if;

  select count(*) into played from public.squad_matches
   where season_id = _season_id and stage = 'league' and status = 'played';
  if played > 0 and not _force then
    raise exception
      '% league fixtures have already been played. Rebuilding would count them twice.', played;
  end if;

  delete from public.squad_matches where season_id = _season_id and stage = 'league';

  for co in
    select coalesce(cohort, 'GENERAL') as cohort
      from public.squads
     where season_id = _season_id and archived_at is null
     group by 1
     having count(*) >= 2
     order by 1
  loop
    select array_agg(id order by name) into ids
      from public.squads
     where season_id = _season_id and archived_at is null
       and coalesce(cohort, 'GENERAL') = co.cohort;

    created := created + public.schedule_round_robin(
      _season_id, ids, first_wk, last_wk, 'league', co.cohort);
    cohorts := cohorts + 1;
  end loop;

  perform public.write_audit('LEAGUE_GENERATED', 'squad_matches', _season_id, null,
    jsonb_build_object('cohorts', cohorts, 'fixtures', created,
                       'weeks', first_wk || '-' || last_wk),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'cohorts', cohorts, 'fixtures', created,
                            'first_week', first_wk, 'last_week', last_wk);
end $function$;

-- ------------------------------------------------------------ qualification

create or replace function public.qualify_squads(_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  cohorts integer; per_cohort integer; through integer;
begin
  select count(distinct coalesce(cohort, 'GENERAL')) into cohorts
    from public.squads where season_id = _season_id and archived_at is null;

  -- Two per cohort is the default. A college running a single cohort would get
  -- a two-squad championship out of that, which is not a championship, so a
  -- lone cohort sends its top four instead.
  per_cohort := case when cohorts <= 1 then 4 else 2 end;

  with ranked as (
    select id,
           row_number() over (
             partition by coalesce(cohort, 'GENERAL')
             order by points desc, wins desc, name
           ) as pos
      from public.squads
     where season_id = _season_id and archived_at is null
  )
  update public.squads q
     set qualified = (ranked.pos <= per_cohort)
    from ranked
   where q.id = ranked.id;

  select count(*) into through
    from public.squads where season_id = _season_id and qualified;

  perform public.write_audit('SQUADS_QUALIFIED', 'squads', _season_id, null,
    jsonb_build_object('cohorts', cohorts, 'per_cohort', per_cohort, 'qualified', through),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'cohorts', cohorts,
                            'per_cohort', per_cohort, 'qualified', through);
end $function$;

-- -------------------------------------------------------------- championship

create or replace function public.generate_championship(_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  first_wk integer; last_wk integer; ids uuid[]; created integer;
begin
  select min(week), max(week) into first_wk, last_wk
    from public.season_plan(_season_id) where phase = 'championship';
  if first_wk is null then
    return jsonb_build_object('ok', true, 'fixtures', 0,
                              'note', 'this season is too short to have a championship phase');
  end if;

  select array_agg(id order by points desc, name) into ids
    from public.squads where season_id = _season_id and qualified and archived_at is null;

  if ids is null or array_length(ids, 1) < 2 then
    return jsonb_build_object('ok', true, 'fixtures', 0,
                              'note', 'fewer than two squads qualified');
  end if;

  delete from public.squad_matches where season_id = _season_id and stage = 'championship';
  created := public.schedule_round_robin(_season_id, ids, first_wk, last_wk, 'championship', null);

  perform public.write_audit('CHAMPIONSHIP_GENERATED', 'squad_matches', _season_id, null,
    jsonb_build_object('squads', array_length(ids, 1), 'fixtures', created),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'squads', array_length(ids, 1), 'fixtures', created);
end $function$;

-- ------------------------------------------------------------------- seeding

create or replace function public.seed_championship(_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare seeded integer;
begin
  -- Seeding reads championship form, not the whole season: a squad that
  -- coasted through a weak cohort should not out-seed one that fought.
  with champ as (
    select q.id,
           coalesce(sum(case when m.home_squad = q.id then m.home_points
                             when m.away_squad = q.id then m.away_points end), 0) as pts
      from public.squads q
      left join public.squad_matches m
        on m.season_id = _season_id and m.stage = 'championship' and m.status = 'played'
       and (m.home_squad = q.id or m.away_squad = q.id)
     where q.season_id = _season_id and q.qualified and q.archived_at is null
     group by q.id
  ), ranked as (
    select c.id, row_number() over (order by c.pts desc, q.points desc, q.name) as pos
      from champ c join public.squads q on q.id = c.id
  )
  update public.squads q set seed = ranked.pos from ranked where q.id = ranked.id;

  get diagnostics seeded = row_count;

  perform public.write_audit('CHAMPIONSHIP_SEEDED', 'squads', _season_id, null,
    jsonb_build_object('seeded', seeded),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'seeded', seeded);
end $function$;

-- ------------------------------------------------------------------ knockout

create or replace function public.generate_knockout(_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  wk integer; starts date; n integer; created integer := 0;
  s1 uuid; s2 uuid; s3 uuid; s4 uuid;
begin
  select min(week) into wk from public.season_plan(_season_id) where phase = 'knockout';
  if wk is null then return jsonb_build_object('ok', true, 'fixtures', 0); end if;
  select starts_on into starts from public.seasons where id = _season_id;

  select count(*) into n from public.squads
   where season_id = _season_id and qualified and archived_at is null and seed is not null;

  if n < 4 then
    -- Too few for semi-finals; the final in the last week settles it directly.
    return jsonb_build_object('ok', true, 'fixtures', 0,
                              'note', 'fewer than four seeded squads - straight to the final');
  end if;

  select id into s1 from public.squads where season_id = _season_id and seed = 1;
  select id into s2 from public.squads where season_id = _season_id and seed = 2;
  select id into s3 from public.squads where season_id = _season_id and seed = 3;
  select id into s4 from public.squads where season_id = _season_id and seed = 4;

  delete from public.squad_matches where season_id = _season_id and stage = 'knockout';

  insert into public.squad_matches
    (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage)
  values
    (_season_id, wk, s1, s4, (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours', 'scheduled', 'knockout'),
    (_season_id, wk, s2, s3, (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours', 'scheduled', 'knockout');
  created := 2;

  perform public.write_audit('KNOCKOUT_GENERATED', 'squad_matches', _season_id, null,
    jsonb_build_object('week', wk, 'fixtures', created),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'week', wk, 'fixtures', created);
end $function$;

-- --------------------------------------------------------------------- final

create or replace function public.generate_final(_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  wk integer; starts date; a uuid; b uuid; semis integer;
begin
  select min(week) into wk from public.season_plan(_season_id) where phase = 'final';
  if wk is null then return jsonb_build_object('ok', false, 'note', 'no final week'); end if;
  select starts_on into starts from public.seasons where id = _season_id;

  select count(*) into semis from public.squad_matches
   where season_id = _season_id and stage = 'knockout' and status = 'played';

  if semis = 2 then
    -- The two semi-final winners. A drawn semi-final falls to the better seed,
    -- which is what the seeding week is for.
    with winners as (
      select case
               when coalesce(m.home_points,0) > coalesce(m.away_points,0) then m.home_squad
               when coalesce(m.away_points,0) > coalesce(m.home_points,0) then m.away_squad
               else (select id from public.squads
                      where id in (m.home_squad, m.away_squad)
                      order by seed nulls last limit 1)
             end as id,
             m.scheduled_at
        from public.squad_matches m
       where m.season_id = _season_id and m.stage = 'knockout' and m.status = 'played'
    )
    select min(id) filter (where rn = 1), min(id) filter (where rn = 2)
      into a, b
      from (select id, row_number() over (order by scheduled_at, id) as rn from winners) w;
  else
    -- No semi-finals were played: the top two seeds contest the final.
    select id into a from public.squads where season_id = _season_id and seed = 1;
    select id into b from public.squads where season_id = _season_id and seed = 2;
  end if;

  if a is null or b is null then
    return jsonb_build_object('ok', false, 'note', 'not enough squads to make a final');
  end if;

  delete from public.squad_matches where season_id = _season_id and stage = 'final';

  insert into public.squad_matches
    (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage)
  values (_season_id, wk, a, b,
          (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours', 'scheduled', 'final');

  perform public.write_audit('FINAL_GENERATED', 'squad_matches', _season_id, null,
    jsonb_build_object('week', wk), (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'week', wk);
end $function$;

-- -------------------------------------------------------------- the conductor

create or replace function public.advance_season(_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

-- The weekly job now scores the finished week first and then lets the season
-- move itself on, so a stage is always built from settled results.
create or replace function public.run_all_seasons()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare s record; done integer := 0; moved integer := 0; closed integer := 0; wk integer;
begin
  for s in select * from public.seasons where is_current and status = 'active' loop
    wk := public.season_week(s.id);

    if wk > 1 then
      perform public.run_squad_week(s.id, wk - 1);
      done := done + 1;
    end if;

    if (select count(*) from public.squads where season_id = s.id and archived_at is null) >= 2 then
      perform public.advance_season(s.id);
      moved := moved + 1;
    end if;

    if wk >= s.planned_weeks then
      perform public.close_season(s.id);
      closed := closed + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'seasons_scored', done,
                            'seasons_advanced', moved, 'seasons_closed', closed,
                            'ran_at', now());
end $function$;

-- The TPO's "generate fixtures" button builds the cohort leagues now.
create or replace function public.tpo_generate_fixtures(_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

revoke all on function public.schedule_round_robin(uuid, uuid[], integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.generate_cohort_league(uuid, boolean) from public, anon, authenticated;
revoke all on function public.qualify_squads(uuid)        from public, anon, authenticated;
revoke all on function public.generate_championship(uuid) from public, anon, authenticated;
revoke all on function public.seed_championship(uuid)     from public, anon, authenticated;
revoke all on function public.generate_knockout(uuid)     from public, anon, authenticated;
revoke all on function public.generate_final(uuid)        from public, anon, authenticated;
revoke all on function public.advance_season(uuid)        from public, anon, authenticated;

grant execute on function public.schedule_round_robin(uuid, uuid[], integer, integer, text, text) to service_role;
grant execute on function public.generate_cohort_league(uuid, boolean) to service_role;
grant execute on function public.qualify_squads(uuid)        to service_role;
grant execute on function public.generate_championship(uuid) to service_role;
grant execute on function public.seed_championship(uuid)     to service_role;
grant execute on function public.generate_knockout(uuid)     to service_role;
grant execute on function public.generate_final(uuid)        to service_role;
grant execute on function public.advance_season(uuid)        to service_role;
