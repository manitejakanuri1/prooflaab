-- ============================================================================
-- Stage 37 — a squad that joins mid-season gets fixtures.
--
-- Before this, a squad created in week 6 was never in the draw, and the only
-- remedy was "Redo match schedule" — which refuses once results exist, quite
-- correctly, since rebuilding would discard them. So the new squad simply never
-- played anything.
--
-- One parameter rather than a second function: generate_round_robin already
-- knows how to draw, it just always drew from round 1. It now takes a starting
-- round, deletes only unplayed fixtures from there onward, and leaves every
-- played round exactly as it was. The rotation still runs from the top so the
-- pairings stay a proper round robin; only the writing is skipped for rounds
-- already behind us.
--
-- Verified: 3 squads with rounds 1-7 played, a fourth squad added, extend run —
-- rounds 1-7 untouched, the new squad picks up 3 fixtures from round 8, and the
-- byes disappear because four squads pair evenly.
-- ============================================================================

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
  -- Only rounds at or after the starting point matter: extending from week 8
  -- has no opinion about week 3.
  select count(*) into already_played from public.squad_matches
   where season_id = _season_id and status = 'played'
     and coalesce(round_number, 1) >= _from_round;

  if already_played > 0 and not _force then
    raise exception
      '% fixtures from round % onward have already been played. Regenerating would count them twice - rebuild the season only if you mean to discard those results.',
      already_played, _from_round;
  end if;

  select array_agg(id order by name) into ids
    from public.squads
   where season_id = _season_id and archived_at is null;
  if ids is null or array_length(ids, 1) < 2 then
    raise exception 'a round robin needs at least two squads';
  end if;

  real_squads := array_length(ids, 1);
  select starts_on, planned_weeks into starts, weeks from public.seasons where id = _season_id;

  delete from public.squad_matches
   where season_id = _season_id
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

      continue when wk < _from_round;

      for i in 1..(n / 2) loop
        a := rotated[i];
        b := rotated[n + 1 - i];
        -- A null on either side is the bye: that squad does not play this round.
        if a is not null and b is not null then
          insert into public.squad_matches
            (season_id, round_number, home_squad, away_squad, scheduled_at, status)
          values (_season_id, wk,
                  case when cycle % 2 = 1 then a else b end,
                  case when cycle % 2 = 1 then b else a end,
                  (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours',
                  'scheduled');
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

drop function if exists public.generate_round_robin(uuid, boolean);

-- Start at the first round nobody has played. Starting at the current week was
-- wrong: the current week has usually been scored already, so it refused for
-- the wrong reason.
create or replace function public.extend_fixtures(_season_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare first_open integer;
begin
  select coalesce(max(coalesce(round_number, 1)), 0) + 1
    into first_open
    from public.squad_matches
   where season_id = _season_id and status = 'played';

  return public.generate_round_robin(_season_id, false, greatest(1, first_open));
end $fn$;

-- Nightly, just after squads form: a squad created at 00:05 has fixtures by
-- 00:07 rather than waiting for somebody to notice.
create or replace function public.extend_all_fixtures()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare s record; touched integer := 0;
begin
  for s in select id from public.seasons where is_current and status = 'active' loop
    -- Only when some squad has no fixture from here on; otherwise this would
    -- redraw every night for no reason.
    if exists (
      select 1 from public.squads q
       where q.season_id = s.id and q.archived_at is null
         and not exists (
           select 1 from public.squad_matches m
            where m.season_id = s.id
              and (m.home_squad = q.id or m.away_squad = q.id)
              and coalesce(m.round_number, 1) >= public.season_week(s.id))
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

revoke all on function public.generate_round_robin(uuid, boolean, integer) from public, anon, authenticated;
revoke all on function public.extend_fixtures(uuid)      from public, anon, authenticated;
revoke all on function public.extend_all_fixtures()      from public, anon, authenticated;
grant execute on function public.generate_round_robin(uuid, boolean, integer) to service_role;
grant execute on function public.extend_fixtures(uuid)   to service_role;
grant execute on function public.extend_all_fixtures()   to service_role;

select cron.schedule('prooflab-extend-fixtures', '7 0 * * *',
  $cron$ select public.extend_all_fixtures(); $cron$);
