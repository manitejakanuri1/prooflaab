-- ============================================================================
-- Stage 30 — two races, both found by code review rather than by testing.
--
-- 1. create_lot_for looks for today's Lot, finds none, and inserts. Two callers
--    arriving together — the nightly job and a student opening the page, or the
--    same page mounted twice — both see nothing and both insert. The partial
--    unique index tasks_one_lot_per_day keeps one row and the loser raises a
--    duplicate-key error: a blank Daily Card for that student, or an aborted
--    nightly run for everyone after them in the loop.
--
--    Reproduced with two sequential calls straddling the check, then fixed and
--    re-run: the second caller now returns the first caller's Lot, and exactly
--    one row exists for the day.
--
-- 2. lot-writer can pay twice for the same topic. Two students reaching a new
--    topic within the same few seconds both read a seed template, both call the
--    model, and the upsert converges them only after both calls are paid for.
--    generating_since is the claim: a conditional UPDATE that exactly one caller
--    can win. It expires after two minutes so a crashed or timed-out generation
--    does not lock a topic out permanently.
--
--    Reproduced with three simultaneous HTTP calls: one wrote, two were told the
--    topic was being written, one provider call was made.
-- ============================================================================

alter table public.lot_templates
  add column if not exists generating_since timestamptz;

create or replace function public.claim_lot_template(_level_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp as $fn$
  with claimed as (
    update public.lot_templates
       set generating_since = now()
     where level_id = _level_id
       and origin = 'seed'
       and (generating_since is null or generating_since < now() - interval '2 minutes')
    returning level_id
  )
  select exists (select 1 from claimed);
$fn$;

create or replace function public.release_lot_template(_level_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $fn$
  update public.lot_templates set generating_since = null where level_id = _level_id;
$fn$;

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

  -- The race: another caller may insert between the read above and this write.
  -- do nothing rather than an error, then read back whichever row won.
  insert into public.tasks
    (student_id, title, description, code_sample, source_jd, difficulty,
     estimate_minutes, lot_category, lot_number, lot_date, level_id,
     status, visibility, due_date, is_ai_generated, created_by_type, source)
  values
    (_student_id, tpl.title, tpl.scenario, tpl.code_sample, tpl.source_jd, tpl.difficulty,
     tpl.estimate_minutes, tpl.lot_category, n, d, lvl,
     'pending', 'private', (d + 1)::timestamptz - interval '1 second',
     tpl.origin = 'ai', 'system', 'daily_lot')
  on conflict (student_id, lot_date) where lot_date is not null do nothing
  returning id into tid;

  if tid is null then
    select t.id into tid from public.tasks t
     where t.student_id = _student_id and t.lot_date = d limit 1;
    return jsonb_build_object('ok', true, 'task_id', tid, 'created', false,
                              'reason', 'another request created it first',
                              'needs_writer', false);
  end if;

  return jsonb_build_object('ok', true, 'task_id', tid, 'created', true,
                            'level_id', lvl, 'needs_writer', tpl.origin = 'seed');
end $fn$;

revoke all on function public.claim_lot_template(uuid)   from public, anon, authenticated;
revoke all on function public.release_lot_template(uuid) from public, anon, authenticated;
revoke all on function public.create_lot_for(uuid, date) from public, anon, authenticated;

-- Named explicitly, and this is the part that was missed the first time.
--
-- "revoke all … from public, anon, authenticated" is the sweep this project uses
-- to keep new functions away from the browser, and it works because Postgres
-- grants EXECUTE to PUBLIC by default. It also strips service_role, which held
-- its EXECUTE only through PUBLIC. lot-writer runs as service_role, so the first
-- deploy of the claim refused every caller — including the one that should have
-- won — and nothing was ever generated. Any function an edge function calls has
-- to be granted back by name.
grant execute on function public.claim_lot_template(uuid)   to service_role;
grant execute on function public.release_lot_template(uuid) to service_role;
grant execute on function public.create_lot_for(uuid, date) to service_role;
