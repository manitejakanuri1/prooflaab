-- 159 (MF-004): league matches only in league weeks, only inside a section.
-- Before: the nightly extend_all_fixtures job ran in every week once the league was over (no squad had a
-- fixture "from here on"), and extend_fixtures -> generate_round_robin deleted EVERY match from that round on
-- (championship, knockout, final too) and drew a league across all squads up to week 12.
-- Now:
--   extend_all_fixtures  runs only in league weeks, and only for a squad that has never had a league fixture
--                        (a squad formed mid-league). It no longer redraws because of a bye.
--   extend_fixtures      draws the rest of the league per section (schedule_round_robin, the same drawer
--                        generate_cohort_league uses), from this week to the last league week, and deletes
--                        only unplayed league matches in that range.
--   generate_round_robin (hand rebuild, no caller left) counts, deletes and draws league matches only, and
--                        only in league weeks.
-- TEST overlay: scripts/dev-tools/staging_test_week_apply.sql has the same generate_round_robin with the
-- 10-minute week timing; re-apply that function on TEST after this file.
-- Rollback: migration/159-rollback-league-fixtures-league-weeks-only.sql
begin;

create or replace function public.generate_round_robin(
  _season_id uuid, _force boolean default false, _from_round integer default 1
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  ids uuid[]; real_squads integer; already_played integer;
  n integer; rounds integer; created integer := 0;
  weeks integer; cycle integer; cycles integer;
  r integer; i integer; wk integer;
  a uuid; b uuid; starts date; rotated uuid[];
begin
  select count(*) into already_played from public.squad_matches
   where season_id = _season_id and stage = 'league' and status = 'played'
     and coalesce(round_number, 1) >= _from_round;

  if already_played > 0 and not _force then
    raise exception
      '% league fixtures from round % onward have already been played. Regenerating would count them twice - rebuild the season only if you mean to discard those results.',
      already_played, _from_round;
  end if;

  select array_agg(id order by name) into ids
    from public.squads
   where season_id = _season_id and archived_at is null;
  if ids is null or array_length(ids, 1) < 2 then
    raise exception 'a round robin needs at least two squads';
  end if;

  real_squads := array_length(ids, 1);
  select starts_on into starts from public.seasons where id = _season_id;
  weeks := coalesce(public.season_league_last_week(_season_id), 0);

  delete from public.squad_matches
   where season_id = _season_id and stage = 'league'
     and coalesce(round_number, 1) >= _from_round;

  if real_squads % 2 = 1 then ids := ids || array[null::uuid]; end if;
  n := array_length(ids, 1);
  rounds := n - 1;
  cycles := ceil(weeks::numeric / rounds);

  for cycle in 1..cycles loop
    for r in 1..rounds loop
      wk := (cycle - 1) * rounds + r;
      exit when wk > weeks;

      if r = 1 then rotated := ids;
      else rotated := array[ids[1]] || (rotated[n:n] || rotated[2:n-1]);
      end if;

      continue when wk < _from_round or public.season_phase(_season_id, wk) is distinct from 'league';

      for i in 1..(n / 2) loop
        a := rotated[i];
        b := rotated[n + 1 - i];
        if a is not null and b is not null then
          insert into public.squad_matches
            (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage)
          values (_season_id, wk,
                  case when cycle % 2 = 1 then a else b end,
                  case when cycle % 2 = 1 then b else a end,
                  (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours',
                  'scheduled', 'league');
          created := created + 1;
        end if;
      end loop;
    end loop;
  end loop;

  perform public.write_audit('ROUND_ROBIN_GENERATED', 'squad_matches', _season_id,
    null, jsonb_build_object('rounds', rounds, 'cycles', cycles,
                             'fixtures', created, 'rebuilt', _force,
                             'from_round', _from_round),
    (select college_id from public.seasons where id = _season_id));

  return jsonb_build_object('ok', true, 'rounds_per_cycle', rounds, 'cycles', cycles,
                            'weeks_covered', least(weeks, cycles * rounds),
                            'fixtures', created, 'squads', real_squads,
                            'from_round', _from_round,
                            'byes_per_cycle', case when real_squads % 2 = 1 then rounds else 0 end);
end $fn$;

create or replace function public.extend_fixtures(_season_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare first_open integer; last_wk integer; co record; ids uuid[]; created integer := 0;
begin
  last_wk := public.season_league_last_week(_season_id);
  select greatest(public.season_week(_season_id),
                  coalesce(max(m.round_number), 0) + 1,
                  (select min(p.week) from public.season_plan(_season_id) p where p.phase = 'league'))
    into first_open
    from public.squad_matches m
   where m.season_id = _season_id and m.stage = 'league' and m.status = 'played';

  if last_wk is null or first_open > last_wk then
    return jsonb_build_object('ok', true, 'fixtures', 0, 'reason', 'the league is over');
  end if;

  delete from public.squad_matches
   where season_id = _season_id and stage = 'league' and status <> 'played'
     and round_number >= first_open;

  for co in
    select coalesce(cohort, 'GENERAL') as cohort
      from public.squads
     where season_id = _season_id and archived_at is null
     group by 1 having count(*) >= 2 order by 1
  loop
    select array_agg(id order by name) into ids
      from public.squads
     where season_id = _season_id and archived_at is null and coalesce(cohort, 'GENERAL') = co.cohort;
    created := created + public.schedule_round_robin(_season_id, ids, first_open, last_wk, 'league', co.cohort);
  end loop;

  perform public.write_audit('LEAGUE_EXTENDED', 'squad_matches', _season_id, null,
    jsonb_build_object('fixtures', created, 'weeks', first_open || '-' || last_wk),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'fixtures', created, 'first_week', first_open, 'last_week', last_wk);
end $fn$;

create or replace function public.extend_all_fixtures()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare s record; touched integer := 0;
begin
  for s in select id from public.seasons where is_current and status = 'active' loop
    continue when public.season_phase(s.id) is distinct from 'league';
    -- Only for a squad that has never had a league fixture (formed mid-league).
    if exists (
      select 1 from public.squads q
       where q.season_id = s.id and q.archived_at is null
         and not exists (
           select 1 from public.squad_matches m
            where m.season_id = s.id and m.stage = 'league'
              and (m.home_squad = q.id or m.away_squad = q.id))
    ) then
      begin
        perform public.extend_fixtures(s.id);
        touched := touched + 1;
      exception when others then
        raise notice 'extend_fixtures failed for season %: %', s.id, sqlerrm;
      end;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'seasons_extended', touched, 'ran_at', now());
end $fn$;

do $$
begin
  if pg_get_functiondef('public.extend_all_fixtures()'::regprocedure) !~ 'season_phase' then
    raise exception '159: extend_all_fixtures still runs outside league weeks';
  end if;
  if pg_get_functiondef('public.generate_round_robin(uuid,boolean,integer)'::regprocedure) !~ 'stage = ''league''' then
    raise exception '159: generate_round_robin still deletes every stage';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
