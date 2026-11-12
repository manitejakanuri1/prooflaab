-- 345 (owner decision 12 Nov 2026, TEST only - REAL needs Purna's sign-off): a squad with 0 league points does
--   not qualify for the section knockout, unless every squad of the section has 0 points (then everything stays as
--   before: all seeded by table order, no final, no champion - migrations 184/210).
--   generate_section_knockout: seeds 1-4 only among squads with points > 0 (same order as before: rank, points, name);
--     a 0-point squad gets its bracket, no seed, qualified = false. Brackets that result use the existing rules:
--     4+ -> semis 1v4, 2v3; 3 -> seed 1 waits in the final; 2 -> straight final; 1 -> see close_season.
--   close_season (plan v2): a section with exactly one seed who has points gets that squad as champion without a
--     match (decided_by 'only_qualifier'), like a walkover; no fake final row is made.
-- Re-runnable: both are create or replace; generate_section_knockout already clears and redraws seeds/fixtures.
-- Rollback: migration/345-rollback-zero-points-do-not-qualify.sql
begin;
CREATE OR REPLACE FUNCTION public.generate_section_knockout(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  wk integer; starts date; pool text[]; at timestamptz; b record; ids uuid[]; n integer; made integer := 0;
  brackets integer := 0;
begin
  select min(week) into wk from public.season_plan(_season_id) where phase = 'knockout';
  if wk is null then return jsonb_build_object('ok', true, 'fixtures', 0); end if;
  select starts_on, cross_sections into starts, pool from public.seasons where id = _season_id;
  at := case when public.test_fast_season(_season_id)
             then (select starts_at from public.season_week_bounds(_season_id, wk)) + interval '6 minutes'
             else (starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours' end;
  perform public.recount_season(_season_id);
  update public.squads set bracket = null, seed = null, qualified = false where season_id = _season_id;
  delete from public.squad_matches where season_id = _season_id and stage in ('knockout', 'final');
  for b in
    select case when coalesce(cohort, 'GENERAL') = any(coalesce(pool, '{}')) then 'Cross-section'
                else coalesce(cohort, 'GENERAL') end as bracket
      from public.squads where season_id = _season_id and archived_at is null
     group by 1 order by 1
  loop
    -- 345: only squads with league points get a seed; if nobody in the section has any, all are seeded as before
    -- (and generate_section_finals / close_season then make no final and no champion, unchanged).
    with sec as (
      select q.id, q.rank, q.points, q.name
        from public.squads q
       where q.season_id = _season_id and q.archived_at is null
         and (case when coalesce(q.cohort, 'GENERAL') = any(coalesce(pool, '{}')) then 'Cross-section'
                   else coalesce(q.cohort, 'GENERAL') end) = b.bracket),
    ranked as (
      select s.id, row_number() over (order by s.rank nulls last, s.points desc, s.name) as pos
        from sec s
       where coalesce(s.points, 0) > 0 or not exists (select 1 from sec z where coalesce(z.points, 0) > 0))
    update public.squads q
       set bracket = b.bracket,
           seed = case when r.pos <= 4 then r.pos end,
           qualified = coalesce(r.pos <= 4, false)
      from sec s left join ranked r on r.id = s.id
     where q.id = s.id;
    select array_agg(id order by seed) into ids
      from public.squads where season_id = _season_id and bracket = b.bracket and seed is not null;
    n := coalesce(array_length(ids, 1), 0);
    brackets := brackets + 1;
    if n >= 4 then
      insert into public.squad_matches (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage, cohort)
      values (_season_id, wk, ids[1], ids[4], at, 'scheduled', 'knockout', b.bracket),
             (_season_id, wk, ids[2], ids[3], at, 'scheduled', 'knockout', b.bracket);
      made := made + 2;
    elsif n = 3 then
      -- seed 1 waits in the final
      insert into public.squad_matches (season_id, round_number, home_squad, away_squad, scheduled_at, status, stage, cohort)
      values (_season_id, wk, ids[2], ids[3], at, 'scheduled', 'knockout', b.bracket);
      made := made + 1;
    end if;
  end loop;
  perform public.write_audit('KNOCKOUT_GENERATED', 'squad_matches', _season_id, null,
    jsonb_build_object('week', wk, 'fixtures', made, 'brackets', brackets),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'week', wk, 'fixtures', made, 'brackets', brackets);
end $function$
;

CREATE OR REPLACE FUNCTION public.close_season(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  podium uuid[]; names text[]; how text; v integer; b record; brackets integer := 0;
  fin record; champ uuid; runner uuid; third uuid; final_how jsonb;
begin
  select plan_version into v from public.seasons where id = _season_id;
  if v = 2 then
    -- 184: a champion in every bracket that played its final and had a league
    delete from public.season_champions where season_id = _season_id;
    for b in select distinct bracket from public.squads where season_id = _season_id and bracket is not null loop
      select * into fin from public.squad_matches
       where season_id = _season_id and stage = 'final' and cohort = b.bracket and status in ('played', 'no_activity')
       order by scheduled_at desc limit 1;
      continue when fin.id is null;
      continue when not exists (
        select 1 from public.squad_matches m join public.squads q on q.id in (m.home_squad, m.away_squad)
         where m.season_id = _season_id and m.stage = 'league' and m.status = 'played' and q.bracket = b.bracket);
      champ := public.match_winner(fin.id);
      runner := case when champ = fin.home_squad then fin.away_squad else fin.home_squad end;
      third := null;
      select q.id into third
        from public.squad_matches m
        join public.squads q on q.id in (m.home_squad, m.away_squad)
       where m.season_id = _season_id and m.stage = 'knockout' and m.cohort = b.bracket
         and m.status in ('played', 'no_activity') and q.id not in (champ, runner)
       order by q.seed nulls last limit 1;
      -- 203 (MF-097): how the final was decided (score / higher_seed)
      insert into public.season_champions (season_id, bracket, champion_squad_id, runner_up_squad_id, third_squad_id, decided_by)
      values (_season_id, b.bracket, champ, runner, third, fin.decided_by);
      brackets := brackets + 1;
    end loop;
    -- 345: a section where only one squad has league points (so only it was seeded): it is the champion without a
    -- knockout match. A lone seed on 0 points (nobody scored), or no league match played, stays without a champion.
    for b in select q.bracket, (array_agg(q.id))[1] as only_id from public.squads q
              where q.season_id = _season_id and q.seed is not null
              group by q.bracket having count(*) = 1 and max(coalesce(q.points, 0)) > 0 loop
      continue when exists (select 1 from public.season_champions c where c.season_id = _season_id and c.bracket = b.bracket);
      -- same as the final rule (210): no league match played in this section means no champion
      continue when not exists (
        select 1 from public.squad_matches m join public.squads q on q.id in (m.home_squad, m.away_squad)
         where m.season_id = _season_id and m.stage = 'league' and m.status = 'played' and q.bracket = b.bracket);
      insert into public.season_champions (season_id, bracket, champion_squad_id, decided_by)
      values (_season_id, b.bracket, b.only_id, 'only_qualifier');
      brackets := brackets + 1;
    end loop;
    if brackets = 1 then
      select array[champion_squad_id, runner_up_squad_id, third_squad_id] into podium
        from public.season_champions where season_id = _season_id;
    end if;
    how := case when brackets > 0 then 'final' else 'no_league' end;
    select jsonb_object_agg(bracket, decided_by) into final_how from public.season_champions where season_id = _season_id;
  else
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
      select q.id into third
        from public.squad_matches m
        join public.squads q on q.id in (m.home_squad, m.away_squad)
       where m.season_id = _season_id and m.stage = 'knockout' and m.status in ('played', 'no_activity')
         and q.id not in (champ, runner)
       order by q.seed nulls last, q.points desc
       limit 1;
      podium := array[champ, runner, third];
      how := 'final';
      final_how := to_jsonb(fin.decided_by);
    elsif exists (select 1 from public.squad_matches
                   where season_id = _season_id and stage = 'league' and status = 'played') then
      select array_agg(id order by points desc nulls last, name)
        into podium
        from public.squads where season_id = _season_id;
      how := 'points';
    else
      podium := null;
      how := 'no_league';
    end if;
  end if;
  select array_agg(q.name order by p.i) into names
    from unnest(podium) with ordinality p(id, i) join public.squads q on q.id = p.id;
  update public.seasons
     set status = 'complete', is_current = false, completed_at = now(),
         champion_squad_id  = podium[1],
         runner_up_squad_id = podium[2],
         third_squad_id     = podium[3]
   where id = _season_id;
  update public.squad_members m set left_at = now()
    from public.squads q
   where q.id = m.squad_id and q.season_id = _season_id and m.left_at is null;
  update public.squads set archived_at = now()
   where season_id = _season_id and archived_at is null;
  perform public.write_audit('SEASON_CLOSED', 'seasons', _season_id, null,
    jsonb_build_object('champion', names[1], 'runner_up', names[2], 'third', names[3],
                       'decided_by', how, 'final_decided_by', final_how, 'brackets', brackets),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'champion', names[1],
                            'runner_up', names[2], 'third', names[3],
                            'decided_by', how, 'final_decided_by', final_how, 'brackets', brackets,
                            'champions', (select coalesce(jsonb_agg(jsonb_build_object(
                                            'bracket', c.bracket, 'champion', q.name, 'decided_by', c.decided_by)
                                            order by c.bracket), '[]'::jsonb)
                                            from public.season_champions c join public.squads q on q.id = c.champion_squad_id
                                           where c.season_id = _season_id));
end $function$
;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.generate_section_knockout(uuid)'::regprocedure);
  if position('345: only squads with league points' in d) = 0 then raise exception '345: knockout not replaced'; end if;
  d := pg_get_functiondef('public.close_season(uuid)'::regprocedure);
  if position('only_qualifier' in d) = 0 then raise exception '345: close_season not replaced'; end if;
  raise notice '345 self-check: true';
end $$;
notify pgrst, 'reload schema';
commit;
