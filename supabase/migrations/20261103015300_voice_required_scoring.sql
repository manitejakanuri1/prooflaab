-- 163 (MF-003, owner rule 28 Oct 2026): voice is mandatory.
--   A student scores for a Daily Lot only when the task passed AND the voice explanation was scored
--   (tasks / task_assignments 'completed', migration 127). Anything less is 0 for that student only.
--   Points per finished Lot: rule 'lot_completed' (platform default 20 = the old full day 10 + 8 + 3, rounded;
--   a college can change it on the Scoring screen). Other activity rows no longer score.
--   settle_round: no finished work on either side -> status 'no_activity' ("No activity yet"), never a played 0-0;
--   the winner and how it was decided (score / draw / higher_seed / no_activity) are saved on the match.
--   generate_final, close_season: use the saved winner, and accept a 'no_activity' semi-final / final.
--   run_all_seasons: also scores every earlier week that was never scored.
-- TEST overlay: run_squad_week, run_all_seasons and generate_final also live in
-- scripts/dev-tools/staging_test_week_apply.sql (10-minute weeks); re-apply those three on TEST after this file.
-- Rollback: migration/163-rollback-voice-required-scoring.sql
begin;

alter table public.squad_matches drop constraint squad_matches_status_check;
alter table public.squad_matches add constraint squad_matches_status_check
  check (status = any (array['scheduled', 'played', 'cancelled', 'no_activity']));
alter table public.squad_matches add column if not exists winner_squad uuid references public.squads(id) on delete set null;
alter table public.squad_matches add column if not exists decided_by text;

insert into public.squad_scoring_rules (metric, label, points, description, college_id)
values ('lot_completed', 'Daily Lot finished', 20,
        'The task passed and the voice explanation was scored. Nothing counts until both are done.', null)
on conflict (metric, college_id) do nothing;

CREATE OR REPLACE FUNCTION public.run_squad_week(_season_id uuid, _week integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  wk integer := coalesce(_week, greatest(1, public.season_week(_season_id) - 1));
  ranked integer := 0;
  played integer := 0;
  w_start timestamptz; w_end timestamptz; pts integer;
begin
  select b.starts_at, b.ends_at into w_start, w_end from public.season_week_bounds(_season_id, wk) b;
  -- 163 (MF-003, owner 28 Oct 2026): a student scores only for a Daily Lot finished in full - the task passed AND
  -- the voice explanation scored (tasks / task_assignments become 'completed' only then, migration 127). Anything
  -- less is 0 for that student only; nothing is taken from the squad or the other members.
  select sr.points into pts from public.squad_scoring_rules sr
   where sr.metric = 'lot_completed'
     and (sr.college_id = (select college_id from public.seasons where id = _season_id) or sr.college_id is null)
   order by sr.college_id nulls last limit 1;
  pts := coalesce(pts, 20);

  insert into public.student_weekly_scores
    (season_id, student_id, squad_id, week, points, breakdown)
  select _season_id, m.student_id, m.squad_id, wk, d.n * pts,
         case when d.n > 0 then jsonb_build_object('lot_completed', d.n) else '{}'::jsonb end
    from public.squad_members m
    join public.squads q on q.id = m.squad_id and q.season_id = _season_id
    cross join lateral (
      select ((select count(*) from public.tasks t
                where t.student_id = m.student_id and t.source = 'daily_lot' and t.status = 'completed'
                  and t.completed_at >= w_start and t.completed_at < w_end)
            + (select count(*) from public.task_assignments a join public.tasks t on t.id = a.task_id
                where a.student_id = m.student_id and t.source = 'daily_lot' and a.status = 'completed'
                  and t.student_id is distinct from m.student_id
                  and a.completed_at >= w_start and a.completed_at < w_end))::int as n
    ) d
   where m.left_at is null
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
end $function$;

CREATE OR REPLACE FUNCTION public.settle_round(_season_id uuid, _round integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer := 0;
begin
  -- 163 (MF-003): neither squad finished any work -> 'no_activity' ("No activity yet"), never a played 0-0.
  -- The winner and how it was decided are saved on the match. A tied semi-final or final (0-0 included) goes to
  -- the higher seed ('higher_seed'); a tied league / championship match is a draw.
  update public.squad_matches m set
    home_points = s.hp,
    away_points = s.ap,
    status = case when s.hp = 0 and s.ap = 0 then 'no_activity' else 'played' end,
    winner_squad = case
      when s.hp > s.ap then m.home_squad
      when s.ap > s.hp then m.away_squad
      when m.stage in ('knockout', 'final') then
        (select q.id from public.squads q where q.id in (m.home_squad, m.away_squad)
          order by q.seed nulls last, q.points desc, q.rank nulls last, q.id limit 1)
    end,
    decided_by = case
      when s.hp <> s.ap then 'score'
      when m.stage in ('knockout', 'final') then 'higher_seed'
      when s.hp = 0 then 'no_activity'
      else 'draw'
    end
    from (select x.id,
                 coalesce((select w.points from public.squad_weekly_scores w
                            where w.season_id = _season_id and w.squad_id = x.home_squad and w.week = _round), 0) as hp,
                 coalesce((select w.points from public.squad_weekly_scores w
                            where w.season_id = _season_id and w.squad_id = x.away_squad and w.week = _round), 0) as ap
            from public.squad_matches x
           where x.season_id = _season_id and x.round_number = _round) s
   where m.id = s.id;
  get diagnostics n = row_count;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.run_all_seasons()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s record; done integer := 0; moved integer := 0; closed integer := 0; wk integer; pw integer;
begin
  for s in select * from public.seasons where is_current and status = 'active' loop
    -- The last week is over: score it (this settles the final), then close.
    if current_date >= s.starts_on + s.planned_weeks * 7
    then
      -- 163 (MF-003): any earlier week that was never scored is scored first.
      for pw in 1..(s.planned_weeks - 1) loop
        if not exists (select 1 from public.squad_weekly_scores x where x.season_id = s.id and x.week = pw) then
          perform public.run_squad_week(s.id, pw);
        end if;
      end loop;
      perform public.run_squad_week(s.id, s.planned_weeks);
      done := done + 1;
      perform public.close_season(s.id);
      closed := closed + 1;
      continue;
    end if;

    wk := public.season_week(s.id);

    -- 163 (MF-003): last week is always (re)scored; any earlier week that was never scored is scored too.
    for pw in 1..(wk - 1) loop
      if pw = wk - 1 or not exists (select 1 from public.squad_weekly_scores x where x.season_id = s.id and x.week = pw) then
        perform public.run_squad_week(s.id, pw);
      end if;
    end loop;
    if wk > 1 then
      done := done + 1;
    end if;

    if (select count(*) from public.squads where season_id = s.id and archived_at is null) >= 2 then
      perform public.advance_season(s.id);
      moved := moved + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'seasons_scored', done,
                            'seasons_advanced', moved, 'seasons_closed', closed,
                            'ran_at', now());
end $function$;

CREATE OR REPLACE FUNCTION public.generate_final(_season_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  wk integer; starts date; winners uuid[]; a uuid; b uuid; semis integer;
begin
  select min(week) into wk from public.season_plan(_season_id) where phase = 'final';
  if wk is null then return jsonb_build_object('ok', false, 'note', 'no final week'); end if;
  select starts_on into starts from public.seasons where id = _season_id;

  select count(*) into semis from public.squad_matches
   where season_id = _season_id and stage = 'knockout' and status in ('played', 'no_activity');

  if semis = 2 then
    select array_agg(id order by scheduled_at, id) into winners
      from (
        select coalesce(m.winner_squad, case
                 when coalesce(m.home_points,0) > coalesce(m.away_points,0) then m.home_squad
                 when coalesce(m.away_points,0) > coalesce(m.home_points,0) then m.away_squad
                 else (select id from public.squads
                        where id in (m.home_squad, m.away_squad)
                        order by seed nulls last limit 1)
               end) as id,
               m.scheduled_at
          from public.squad_matches m
         where m.season_id = _season_id and m.stage = 'knockout' and m.status in ('played', 'no_activity')
      ) w;
    a := winners[1];
    b := winners[2];
  else
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
  else
    select array_agg(id order by points desc nulls last, name)
      into podium
      from public.squads where season_id = _season_id;
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
                       'decided_by', case when fin.id is not null then 'final' else 'points' end),
    (select college_id from public.seasons where id = _season_id));
  return jsonb_build_object('ok', true, 'champion', names[1],
                            'runner_up', names[2], 'third', names[3],
                            'decided_by', case when fin.id is not null then 'final' else 'points' end);
end $function$;

CREATE OR REPLACE FUNCTION public.tpo_scoring_rules()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'metric', d.metric, 'label', d.label, 'description', d.description,
           'default_points', d.points,
           'points', coalesce(o.points, d.points),
           'customized', o.points is not null)
         order by d.metric), '[]'::jsonb)
    from public.squad_scoring_rules d
    left join public.squad_scoring_rules o
      on o.metric = d.metric and o.college_id = public.my_college_id()
   -- 163 (MF-003): only a Daily Lot finished in full scores now; the other rows no longer count.
   where d.college_id is null and d.metric = 'lot_completed';
$function$;

do $$
begin
  if pg_get_functiondef('public.run_squad_week(uuid,integer)'::regprocedure) !~ 'lot_completed' then
    raise exception '163: run_squad_week still scores single activities';
  end if;
  if pg_get_functiondef('public.settle_round(uuid,integer)'::regprocedure) !~ 'no_activity' then
    raise exception '163: settle_round still marks 0-0 as played';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
