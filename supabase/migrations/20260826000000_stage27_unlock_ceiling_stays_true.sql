-- ============================================================================
-- Stage 27 — the ladder stops refusing topics the student has earned.
--
-- student_tracks.unlocked_through is the wall: level-open compares a topic
-- against it and refuses anything past it. Two faults, both found by walking
-- the flow as a real student rather than by reading it.
--
--   1. The number was only recomputed inside level-open, and only AFTER the
--      refusal. Anything that changed progress from somewhere else — placement,
--      the roadmap planner, a status change — left the wall behind, and the
--      student was locked out by a number nothing had updated. It had already
--      happened to everyone: making 'revise' an unblocking status (the
--      Foundations change) moved nobody's wall, so a student with three topics
--      revised still had a wall at 1 and a week plan pointing at topic 5.
--
--   2. The walk was per row, and a topic is several rows. A Foundations topic
--      arrives as a single 'revise' row and expands into seven steps the first
--      time it is opened, six of them untouched — so opening a topic you were
--      told to skim dropped the wall back onto it and locked everything above.
--      Revise must never block. That is the whole point of the status.
--
-- Fixed at the point every path shares: a trigger on the progress rows.
-- ============================================================================


-- The same walk advanceUnlock does in TypeScript, deliberately kept in step
-- with it: a topic stops blocking when every row of it is finished, or when any
-- row says 'placed' or 'revise' — the resume saying they already know it.
create or replace function public.unlock_ceiling(_student_id uuid, _track text)
returns integer language sql stable set search_path = public, pg_temp as $fn$
  with topic as (
    select l.level_number,
           bool_or(coalesce(sl.status, 'new') in ('placed', 'revise'))              as credited,
           bool_and(coalesce(sl.status, 'new') in ('placed', 'cleared', 'mastered')) as finished
      from public.levels l
      left join public.student_levels sl
        on sl.level_id = l.id and sl.student_id = _student_id
     where l.track_slug = _track
     group by l.level_number
  )
  select greatest(1, coalesce(
    (select min(level_number) from topic where not (credited or finished)),
    (select max(level_number) + 1 from topic)));
$fn$;

create or replace function public.refresh_unlock(_student_id uuid, _track text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
declare ceiling integer := public.unlock_ceiling(_student_id, _track);
begin
  -- greatest(), never a straight assignment: a wall only ever moves forward.
  -- Taking away access somebody already had, because of a status change
  -- somewhere below them, would be worse than the bug this fixes.
  update public.student_tracks
     set unlocked_through = greatest(coalesce(unlocked_through, 1), ceiling)
   where student_id = _student_id and track_slug = _track;
  return ceiling;
end $fn$;

create or replace function public.student_levels_refresh_unlock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare slug text;
begin
  select track_slug into slug from public.levels where id = new.level_id;
  if slug is not null then perform public.refresh_unlock(new.student_id, slug); end if;
  return null;
end $fn$;

drop trigger if exists student_levels_unlock_wall on public.student_levels;
create trigger student_levels_unlock_wall
  after insert or update of status on public.student_levels
  for each row execute function public.student_levels_refresh_unlock();

-- Everybody who is already behind the wall.
do $$
declare t record;
begin
  for t in select student_id, track_slug from public.student_tracks loop
    perform public.refresh_unlock(t.student_id, t.track_slug);
  end loop;
end $$;


-- ── the plan and the Lot obey the same wall ─────────────────────────────
-- Neither knew there was one, so both could hand a student a topic that
-- level-open then refused.
create or replace function public.next_lot_level(_student_id uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $fn$
  with track as (
    select track_slug, coalesce(unlocked_through, 1) as wall
      from public.student_tracks
     where student_id = _student_id order by created_at desc limit 1
  ), planned as (
    select p.level_id, p.slot
      from public.student_week_plan p
      join public.levels l on l.id = p.level_id
      join track t on t.track_slug = l.track_slug
      left join public.student_levels sl
        on sl.level_id = p.level_id and sl.student_id = _student_id
     where p.student_id = _student_id
       and p.week_start = date_trunc('week', current_date)::date
       and coalesce(sl.status, 'new') not in ('cleared', 'mastered', 'placed')
       and l.level_number <= t.wall
     order by p.slot
     limit 1
  ), fallback as (
    select l.id as level_id
      from public.levels l
      join track t on t.track_slug = l.track_slug
      left join public.student_levels sl
        on sl.level_id = l.id and sl.student_id = _student_id
     where coalesce(sl.status, 'new') not in ('cleared', 'mastered', 'placed')
       and l.level_number <= t.wall
     order by l.level_number, l.sub_level
     limit 1
  )
  select coalesce((select level_id from planned), (select level_id from fallback));
$fn$;

create or replace function public.plan_student_week(
  _student_id uuid, _week_start date default null
) returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  wk date := coalesce(_week_start, date_trunc('week', current_date)::date);
  track text;
  wall integer;
  picked integer := 0;
  r record;
begin
  select track_slug, coalesce(unlocked_through, 1) into track, wall
    from public.student_tracks
   where student_id = _student_id order by created_at desc limit 1;
  if track is null then return 0; end if;

  delete from public.student_week_plan
   where student_id = _student_id and week_start = wk;

  for r in
    select l.id from public.student_levels sl
      join public.levels l on l.id = sl.level_id
     where sl.student_id = _student_id and l.track_slug = track and sl.status = 'opened'
       and l.level_number <= wall
     order by l.level_number limit 2
  loop
    picked := picked + 1;
    insert into public.student_week_plan
      (student_id, week_start, level_id, slot, reason, reason_code)
    values (_student_id, wk, r.id, picked,
            'You started this and did not finish it. Worth closing first.', 'retry');
  end loop;

  for r in
    select l.id from public.student_levels sl
      join public.levels l on l.id = sl.level_id
     where sl.student_id = _student_id and l.track_slug = track and sl.status = 'revise'
       and l.level_number <= wall
     order by l.level_number limit 2
  loop
    exit when picked >= 4;
    picked := picked + 1;
    insert into public.student_week_plan
      (student_id, week_start, level_id, slot, reason, reason_code)
    values (_student_id, wk, r.id, picked,
            'Your resume says you know this. A quick pass to be sure, then it is done.', 'revise');
  end loop;

  for r in
    select l.id, coalesce(sl.status, 'new') as st
      from public.levels l
      left join public.student_levels sl
        on sl.level_id = l.id and sl.student_id = _student_id
     where l.track_slug = track and l.sub_level = 1
       and l.level_number <= wall
       and coalesce(sl.status, 'new') not in ('placed','cleared','mastered')
       and l.id not in (select level_id from public.student_week_plan
                         where student_id = _student_id and week_start = wk)
     order by l.level_number
     limit greatest(0, 5 - picked)
  loop
    picked := picked + 1;
    insert into public.student_week_plan
      (student_id, week_start, level_id, slot, reason, reason_code)
    values (_student_id, wk, r.id, picked,
            case when r.st = 'revise'
                 then 'Your resume says you know this. A quick pass to be sure, then it is done.'
                 else 'The next step on your path.' end,
            case when r.st = 'revise' then 'revise' else 'next' end);
  end loop;

  return picked;
end $fn$;


-- ── a Lot already handed out can be pointing above the wall ─────────────
-- Every Lot made before the wall was repaired was. Nothing else notices,
-- because the card links to Submit and Explain rather than to the topic, so the
-- student is quietly working on something the ladder will not open.
--
-- Repaired in place rather than deleted and remade: same row, same lot number,
-- retargeted at the topic they can actually do — and only while it is
-- untouched, because a Lot somebody has started is theirs.
create or replace function public.create_lot_for(_student_id uuid, _for_date date default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  d     date := coalesce(_for_date, current_date);
  lvl   uuid;
  tpl   record;
  n     integer;
  tid   uuid;
  cur   record;
begin
  select t.id, t.level_id, t.status, t.started_at, l.level_number, l.track_slug
    into cur
    from public.tasks t
    left join public.levels l on l.id = t.level_id
   where t.student_id = _student_id and t.lot_date = d
   limit 1;

  if cur.id is not null then
    if cur.level_id is null
       or cur.status <> 'pending'
       or cur.started_at is not null
       or cur.level_number <= coalesce((select unlocked_through from public.student_tracks
                                         where student_id = _student_id
                                           and track_slug = cur.track_slug), 1) then
      return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                                'needs_writer', false);
    end if;

    lvl := public.next_lot_level(_student_id);
    if lvl is null or lvl = cur.level_id then
      return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                                'needs_writer', false);
    end if;

    select * into tpl from public.lot_templates where level_id = lvl;
    if tpl is null then
      perform public.seed_lot_template(lvl);
      select * into tpl from public.lot_templates where level_id = lvl;
    end if;

    update public.tasks
       set level_id = lvl, title = tpl.title, description = tpl.scenario,
           code_sample = tpl.code_sample, source_jd = tpl.source_jd,
           difficulty = tpl.difficulty, estimate_minutes = tpl.estimate_minutes,
           lot_category = tpl.lot_category, is_ai_generated = tpl.origin = 'ai'
     where id = cur.id;

    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'retargeted', true, 'level_id', lvl,
                              'needs_writer', tpl.origin = 'seed');
  end if;

  lvl := public.next_lot_level(_student_id);
  if lvl is null then
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
                              'reason', 'no topic due', 'needs_writer', false);
  end if;

  select * into tpl from public.lot_templates where level_id = lvl;
  if tpl is null then
    perform public.seed_lot_template(lvl);
    select * into tpl from public.lot_templates where level_id = lvl;
  end if;
  if tpl is null then
    return jsonb_build_object('ok', false, 'reason', 'no template', 'needs_writer', false);
  end if;

  select count(*) + 1 into n from public.tasks
   where student_id = _student_id and lot_date is not null;

  insert into public.tasks
    (student_id, title, description, code_sample, source_jd, difficulty,
     estimate_minutes, lot_category, lot_number, lot_date, level_id,
     status, visibility, due_date, is_ai_generated, created_by_type, source)
  values
    (_student_id, tpl.title, tpl.scenario, tpl.code_sample, tpl.source_jd, tpl.difficulty,
     tpl.estimate_minutes, tpl.lot_category, n, d, lvl,
     'pending', 'private', (d + 1)::timestamptz - interval '1 second',
     tpl.origin = 'ai', 'system', 'daily_lot')
  returning id into tid;

  return jsonb_build_object('ok', true, 'task_id', tid, 'created', true,
                            'level_id', lvl, 'needs_writer', tpl.origin = 'seed');
end $fn$;

revoke all on function public.unlock_ceiling(uuid, text)        from public, anon, authenticated;
revoke all on function public.refresh_unlock(uuid, text)        from public, anon, authenticated;
revoke all on function public.next_lot_level(uuid)              from public, anon, authenticated;
revoke all on function public.plan_student_week(uuid, date)     from public, anon, authenticated;
revoke all on function public.create_lot_for(uuid, date)        from public, anon, authenticated;
