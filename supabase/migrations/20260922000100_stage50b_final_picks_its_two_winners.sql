-- ============================================================================
-- Stage 50b — generate_final could never run.
--
-- It picked the two semi-final winners with
--
--     select min(id) filter (where rn = 1), min(id) filter (where rn = 2)
--
-- and Postgres has no min() for uuid, so the whole function threw
-- "function min(uuid) does not exist" the moment two semi-finals had been
-- played. Nothing caught it earlier because it only fires in the last week of
-- a season that actually reached a knockout; a twelve-week simulation with
-- three cohorts and 212 students is what found it.
--
-- array_agg does have an ordered form, so the two winners are now taken as the
-- first and second elements of one ordered array.
-- ============================================================================

create or replace function public.generate_final(_season_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  wk integer; starts date; winners uuid[]; a uuid; b uuid; semis integer;
begin
  select min(week) into wk from public.season_plan(_season_id) where phase = 'final';
  if wk is null then return jsonb_build_object('ok', false, 'note', 'no final week'); end if;
  select starts_on into starts from public.seasons where id = _season_id;

  select count(*) into semis from public.squad_matches
   where season_id = _season_id and stage = 'knockout' and status = 'played';

  if semis = 2 then
    -- The two semi-final winners. A drawn semi-final falls to the better seed,
    -- which is what the seeding week is for.
    select array_agg(id order by scheduled_at, id) into winners
      from (
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
      ) w;
    a := winners[1];
    b := winners[2];
  else
    -- No semi-finals were played: the top two seeds contest the final.
    select id into a from public.squads where season_id = _season_id and seed = 1;
    select id into b from public.squads where season_id = _season_id and seed = 2;
  end if;

  if a is null or b is null or a = b then
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
