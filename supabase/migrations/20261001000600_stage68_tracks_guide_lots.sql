-- stage68: Tracks guide Lots.
--
-- Fixes five things that were quietly wrong:
--   1. Lots could be generated for a student's SECOND track instead of their
--      primary one (next_lot_level/plan_student_week picked by created_at only).
--   2. The same Lot could repeat every day forever, because nothing steered
--      away from a level that was just served.
--   3. Verified proof tasks never actually paid XP (xp_reward was set but
--      nothing read it on verification).
--   4. A multi-step topic could log "topic_cleared" more than once (once per
--      step) instead of once per topic.
--   5. "No Lot today" always said "your path has not been set", even for a
--      student who finished their whole track.
--
-- Lots still never touch student_levels.status. A level is cleared only by
-- level-quiz-submit (checkpoint pass) or level-open (explanation advance).

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns and indexes
-- ---------------------------------------------------------------------------

alter table public.lot_templates
  add column if not exists xp_reward integer not null default 10 check (xp_reward >= 0);

comment on column public.lot_templates.xp_reward is
  'XP paid once, on verification, to a task built from this template. Set to 0 to switch off Lot XP without a deploy.';

-- One primary track per student. placeStudent() in _shared/levels.ts already
-- enforces this in application code; this makes it a database guarantee.
create unique index if not exists student_tracks_one_primary
  on public.student_tracks (student_id)
  where is_primary;

-- One proof per task per student, in any status. UploadProofModal.tsx already
-- checks this in the browser; this closes the same gap at the database.
create unique index if not exists proof_uploads_one_per_task
  on public.proof_uploads (task_id, student_id);

-- XP for a task pays out once. source is always 'task:<task_id>' when this
-- index applies (see on_proof_reviewed below and stage69's
-- record_task_submission).
create unique index if not exists xp_logs_one_award_per_task
  on public.xp_logs (student_id, source)
  where source like 'task:%';

-- ---------------------------------------------------------------------------
-- 2. Count a topic once, not once per step
-- ---------------------------------------------------------------------------

create or replace function public.is_last_step(_level_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select not exists (
    select 1
      from public.levels l
      join public.levels l2
        on l2.track_slug = l.track_slug
       and l2.level_number = l.level_number
       and l2.sub_level > l.sub_level
     where l.id = _level_id
  );
$$;

comment on function public.is_last_step(uuid) is
  'True when this row is a topic''s last step (its checkpoint, or its only step). A topic should log topic_cleared once, on this row, not once per step.';

create or replace function public.activity_from_level()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only the moment it is first cleared, and only on the topic's last step.
  -- Re-saving a cleared topic is not a second achievement, and an explanation
  -- step three rows before the checkpoint is not the topic finishing.
  if new.status in ('cleared','mastered')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and public.is_last_step(new.level_id) then
    perform public.log_activity(new.student_id, 'topic_cleared', 'student_levels', new.id);
  end if;
  return new;
end
$$;

create or replace function public.on_level_cleared()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('cleared','mastered')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and public.is_last_step(new.level_id) then
    perform public.record_activity(new.student_id, 'topic_cleared');
  end if;
  return new;
end
$$;

-- level-quiz-submit upserts student_levels, so a first clear can arrive as an
-- INSERT, not only an UPDATE OF status. The old trigger only fired on UPDATE,
-- so a level that went straight from "no row" to "cleared" in one upsert never
-- logged topic_cleared at all.
drop trigger if exists student_levels_record_activity on public.student_levels;
create trigger student_levels_record_activity
  after insert or update of status on public.student_levels
  for each row execute function public.on_level_cleared();

-- ---------------------------------------------------------------------------
-- 3. Lots follow the primary track, and rotate instead of repeating
-- ---------------------------------------------------------------------------

create or replace function public.next_lot_level(_student_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with track as (
    select track_slug, coalesce(unlocked_through, 1) as wall
      from public.student_tracks
     where student_id = _student_id
     order by is_primary desc, created_at desc   -- CHANGED: primary track wins
     limit 1
  ), recent as (
    -- Steps that already had a Lot in the last 3 days (not counting today).
    -- Only used to break ties among otherwise-equal candidates below, so a
    -- student stuck on one checkpoint still gets that checkpoint's Lot every
    -- day rather than none at all.
    -- ponytail: 3-day window is a constant here; move to a settings row if a
    -- college ever wants to tune it.
    select distinct k.level_id
      from public.tasks k
     where k.student_id = _student_id
       and k.lot_date >= current_date - 3 and k.lot_date < current_date
       and k.level_id is not null
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
     order by (p.level_id in (select level_id from recent)), p.slot   -- CHANGED: rotate
     limit 1
  ), fallback as (
    select l.id as level_id
      from public.levels l
      join track t on t.track_slug = l.track_slug
      left join public.student_levels sl
        on sl.level_id = l.id and sl.student_id = _student_id
      left join public.topic_ratings tr
        on tr.student_id = _student_id and tr.topic = l.skill
     where coalesce(sl.status, 'new') not in ('cleared', 'mastered', 'placed')
       and l.level_number <= t.wall
     -- Ladder order still comes first, so nobody skips ahead. The rating
     -- decides which topic to serve when several sit on the same rung, and a
     -- recently-served step now sorts last among ties on the same rung.
     order by l.level_number,
              (l.id in (select level_id from recent)),                -- CHANGED: rotate
              (coalesce(2200 - tr.rating, 0)::numeric / 1400
               * (1 - coalesce(tr.confidence, 0) * 0.5)) desc,
              l.sub_level
     limit 1
  )
  select coalesce((select level_id from planned), (select level_id from fallback));
$$;

comment on function public.next_lot_level(uuid) is
  'Picks the level a student''s next Lot should be about: the primary track''s wall, and a step served in the last 3 days sorts behind one that was not, when both are otherwise equal.';

-- plan_student_week has the identical track-pick bug. Same one-line fix.
create or replace function public.plan_student_week(_student_id uuid, _week_start date default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wk date := coalesce(_week_start, date_trunc('week', current_date)::date);
  track text;
  wall integer;
  picked integer := 0;
  r record;
begin
  select track_slug, coalesce(unlocked_through, 1) into track, wall
    from public.student_tracks
   where student_id = _student_id
   order by is_primary desc, created_at desc   -- CHANGED: primary track wins
   limit 1;
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
                 else 'Next on the ladder.' end,
            case when r.st = 'revise' then 'revise' else 'ladder' end);
  end loop;

  return picked;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. my_todays_lot tells the Daily Card what track/level the Lot is about
-- ---------------------------------------------------------------------------

-- Return type changes (columns added), so this has to be dropped first.
drop function if exists public.my_todays_lot();

create function public.my_todays_lot()
returns table (
  id uuid, lot_number integer, title text, description text, code_sample text,
  source_jd text, difficulty text, estimate_minutes integer, lot_category text,
  status text, due_date timestamptz, sponsored_by_company text,
  level_id uuid, level_number integer, track_slug text, track_name text,
  total_levels integer, level_status text, is_foundation boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.lot_number, t.title, t.description, t.code_sample, t.source_jd,
         t.difficulty, t.estimate_minutes, t.lot_category, t.status, t.due_date,
         r.company,
         l.id, l.level_number, l.track_slug, lt.name,
         (select count(distinct l2.level_number)::integer
            from public.levels l2 where l2.track_slug = l.track_slug),
         coalesce(sl.status, 'new'),
         coalesce(l.level_number between ph.from_level and ph.to_level, false)
    from public.tasks t
    left join public.recruiters r      on r.id = t.sponsored_by
    left join public.levels l          on l.id = t.level_id
    left join public.level_tracks lt   on lt.slug = l.track_slug
    left join public.student_levels sl on sl.level_id = l.id and sl.student_id = t.student_id
    left join public.track_phases ph   on ph.track_slug = l.track_slug and ph.phase_number = 1
   where t.student_id = auth.uid() and t.lot_date = current_date
   limit 1;
$$;

revoke all on function public.my_todays_lot() from public, anon;
grant execute on function public.my_todays_lot() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. create_lot_for: pay the template's XP, say WHY nothing is due
-- ---------------------------------------------------------------------------

create or replace function public.create_lot_for(_student_id uuid, _for_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d     date := coalesce(_for_date, current_date);
  lvl   uuid;
  tpl   record;
  n     integer;
  tid   uuid;
  cur   record;
  prev  text;
begin
  select t.id, t.level_id, t.status, t.started_at, l.level_number, l.track_slug
    into cur
    from public.tasks t
    left join public.levels l on l.id = t.level_id
   where t.student_id = _student_id and t.lot_date = d
   limit 1;

  if cur.id is not null then
    -- Already has today's Lot, and it points somewhere they can go. It may
    -- still be the seed version — the nightly job creates plenty of those —
    -- so the answer about whether it needs writing comes from the template.
    if cur.level_id is null
       or cur.status <> 'pending'
       or cur.started_at is not null
       or cur.level_number <= coalesce((select unlocked_through from public.student_tracks
                                         where student_id = _student_id
                                           and track_slug = cur.track_slug), 1) then
      return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                                'level_id', cur.level_id,
                                'needs_writer', public.lot_needs_writer(cur.id));
    end if;

    lvl := public.next_lot_level(_student_id);
    if lvl is null or lvl = cur.level_id then
      return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                                'level_id', cur.level_id,
                                'needs_writer', public.lot_needs_writer(cur.id));
    end if;

    select * into tpl from public.lot_templates where level_id = lvl;
    if tpl is null then
      perform public.seed_lot_template(lvl);
      select * into tpl from public.lot_templates where level_id = lvl;
    end if;

    -- xp_reward (and, from stage69/70 on, sandbox_config_id/rubric_config_id)
    -- are protected by protect_tasks. Without app.system_write this write
    -- would go through and then be silently reverted back to the old values.
    prev := current_setting('app.system_write', true);
    perform set_config('app.system_write', 'on', true);
    update public.tasks
       set level_id = lvl, title = tpl.title, description = tpl.scenario,
           code_sample = tpl.code_sample, source_jd = tpl.source_jd,
           difficulty = tpl.difficulty, estimate_minutes = tpl.estimate_minutes,
           lot_category = tpl.lot_category, is_ai_generated = tpl.origin = 'ai',
           xp_reward = tpl.xp_reward                                   -- CHANGED
     where id = cur.id;
    perform set_config('app.system_write', coalesce(prev, ''), true);

    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'retargeted', true, 'level_id', lvl,
                              'needs_writer', tpl.origin = 'seed');
  end if;

  lvl := public.next_lot_level(_student_id);
  if lvl is null then
    -- CHANGED: say WHY nothing is due. 'reason' stays 'no topic due' so older
    -- frontends keep working; 'detail' is the new, more honest field.
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
      'reason', 'no topic due',
      'detail', case
        when not exists (select 1 from public.student_tracks where student_id = _student_id)
          then 'no track'
        when not exists (
          select 1
            from public.levels l
            left join public.student_levels sl
              on sl.level_id = l.id and sl.student_id = _student_id
           where l.track_slug = (select track_slug from public.student_tracks
                                  where student_id = _student_id
                                  order by is_primary desc, created_at desc limit 1)
             and coalesce(sl.status, 'new') not in ('placed', 'cleared', 'mastered'))
          then 'track complete'
        -- The wall says a step is open, but nothing eligible was found. This
        -- should never happen (student_levels_unlock_wall keeps the wall in
        -- step with real progress) — surfaced honestly rather than papered
        -- over, so monitoring query 7 in the report can catch it if it does.
        else 'waiting' end,
      'needs_writer', false);
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
     status, visibility, due_date, is_ai_generated, created_by_type, source,
     xp_reward)                                                        -- CHANGED
  values
    (_student_id, tpl.title, tpl.scenario, tpl.code_sample, tpl.source_jd, tpl.difficulty,
     tpl.estimate_minutes, tpl.lot_category, n, d, lvl,
     'pending', 'private', (d + 1)::timestamptz - interval '1 second',
     tpl.origin = 'ai', 'system', 'daily_lot',
     tpl.xp_reward)                                                    -- CHANGED
  on conflict (student_id, lot_date) where lot_date is not null do nothing
  returning id into tid;

  -- Lost the race. Report the winner's Lot, and the winner's topic and
  -- whether it still needs writing, so the screen can ask for the written
  -- version instead of leaving the student on the seed.
  if tid is null then
    select t.id, t.level_id into cur from public.tasks t
     where t.student_id = _student_id and t.lot_date = d limit 1;
    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'reason', 'another request created it first',
                              'level_id', cur.level_id,
                              'needs_writer', public.lot_needs_writer(cur.id));
  end if;

  return jsonb_build_object('ok', true, 'task_id', tid, 'created', true,
                            'level_id', lvl, 'needs_writer', tpl.origin = 'seed');
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Pay task XP on verification, once, and rate a Lot's topic on review
-- ---------------------------------------------------------------------------

create or replace function public.on_proof_reviewed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  k     record;
  n     integer;
  prev  text;
  topic text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select id, xp_reward, source, level_id into k from public.tasks where id = new.task_id;
  if k.id is null then
    return new;
  end if;
  if k.level_id is not null then
    select skill into topic from public.levels where id = k.level_id;
  end if;

  if new.status = 'Verified' then
    if coalesce(k.xp_reward, 0) > 0 then
      insert into public.xp_logs (student_id, xp_points, source)
      values (new.student_id, k.xp_reward, 'task:' || k.id)
      on conflict (student_id, source) where source like 'task:%' do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        prev := current_setting('app.system_write', true);
        perform set_config('app.system_write', 'on', true);
        update public.student_profiles
           set total_xp = coalesce(total_xp, 0) + k.xp_reward
         where id = new.student_id;
        perform set_config('app.system_write', coalesce(prev, ''), true);
      end if;
    end if;

    if k.source = 'daily_lot' and topic is not null then
      perform public.record_topic_attempt(new.student_id, topic, 'correct', k.level_id, null);
    end if;

  elsif new.status = 'Rejected' and k.source = 'daily_lot' and topic is not null then
    perform public.record_topic_attempt(new.student_id, topic, 'incorrect', k.level_id, null);
  end if;

  return new;
end
$$;

comment on function public.on_proof_reviewed() is
  'Pays tasks.xp_reward once, on Verified, via the xp_logs_one_award_per_task index. Separate from on_proof_change/activity_from_proof, which only log activity events.';

drop trigger if exists proof_uploads_review_effects on public.proof_uploads;
create trigger proof_uploads_review_effects
  after update of status on public.proof_uploads
  for each row execute function public.on_proof_reviewed();

commit;
