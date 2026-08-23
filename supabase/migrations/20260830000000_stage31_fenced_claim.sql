-- ============================================================================
-- Stage 31 — the second review, on the fix from the first.
--
-- Greptile re-read PR #1 after stage 30 landed and raised two more. Both valid,
-- and a third turned up while proving them.
--
--   1. The two-minute lease expires while the model is still working. DeepSeek,
--      its retry and the two fallbacks behind it can outlast two minutes, and
--      nothing renewed the claim — so a second caller could take the topic and
--      start a second paid call while the first was still in flight. Exactly
--      the charge the claim exists to prevent.
--
--   2. A caller that lost the Lot insert race returned needs_writer false and
--      no level_id, so the Daily Card never asked for the written version and
--      the student sat on the plain seed Lot all day. That was one case of a
--      wider hole: every path returning an existing Lot said needs_writer
--      false, including the ordinary one where the nightly job had created it
--      from a seed template hours earlier.
--
--   3. Found by re-running the concurrency test rather than trusting the fix:
--      the claim only ran when a template row already existed, because in the
--      normal flow create_lot_for seeds one first. Any caller reaching a topic
--      with no row — an admin, a direct call — took an unfenced path. Four
--      concurrent requests on a fresh topic produced four paid calls.
--
-- The claim now issues a token, is heartbeated while the model works, fences
-- the write, and covers topics that have no row yet.
-- ============================================================================

alter table public.lot_templates
  add column if not exists generating_by uuid;

-- Returns the ownership token, or null when somebody else holds the claim.
drop function if exists public.claim_lot_template(uuid);
create or replace function public.claim_lot_template(_level_id uuid)
returns uuid language sql security definer set search_path = public, pg_temp as $fn$
  with claimed as (
    update public.lot_templates
       set generating_since = now(), generating_by = gen_random_uuid()
     where level_id = _level_id
       and origin = 'seed'
       and (generating_since is null or generating_since < now() - interval '2 minutes')
    returning generating_by
  )
  select generating_by from claimed;
$fn$;

-- Seeding and claiming in one statement: there is no state in which a caller
-- can generate without holding the claim.
create or replace function public.ensure_and_claim_lot_template(_level_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if not exists (select 1 from public.lot_templates where level_id = _level_id) then
    perform public.seed_lot_template(_level_id);
  end if;
  return public.claim_lot_template(_level_id);
end $fn$;

-- The heartbeat, sent every thirty seconds while the model is working. Only the
-- holder can push the lease forward, so the lease still lapses if the isolate
-- has actually died.
create or replace function public.touch_lot_template(_level_id uuid, _token uuid)
returns boolean language sql security definer set search_path = public, pg_temp as $fn$
  with beat as (
    update public.lot_templates set generating_since = now()
     where level_id = _level_id and generating_by = _token
    returning 1
  )
  select exists (select 1 from beat);
$fn$;

-- The fenced write: a caller whose lease lapsed and was taken by somebody else
-- writes nothing rather than overwriting the work that replaced it.
create or replace function public.save_lot_template(
  _level_id uuid, _token uuid, _title text, _scenario text,
  _code_sample text, _source_jd text, _difficulty text,
  _estimate_minutes integer, _lot_category text
) returns boolean language sql security definer set search_path = public, pg_temp as $fn$
  with saved as (
    update public.lot_templates
       set title = _title, scenario = _scenario, code_sample = _code_sample,
           source_jd = _source_jd, difficulty = _difficulty,
           estimate_minutes = _estimate_minutes, lot_category = _lot_category,
           origin = 'ai', generating_since = null, generating_by = null,
           updated_at = now()
     where level_id = _level_id and generating_by = _token
    returning 1
  )
  select exists (select 1 from saved);
$fn$;

drop function if exists public.release_lot_template(uuid);
create or replace function public.release_lot_template(_level_id uuid, _token uuid)
returns void language sql security definer set search_path = public, pg_temp as $fn$
  update public.lot_templates
     set generating_since = null, generating_by = null
   where level_id = _level_id and generating_by = _token;
$fn$;

-- Is the work behind this Lot still the plain seed version?
create or replace function public.lot_needs_writer(_task_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce((select t.origin = 'seed'
                     from public.tasks k
                     join public.lot_templates t on t.level_id = k.level_id
                    where k.id = _task_id), false);
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
    -- Already has today's Lot, and it points somewhere they can go. It may
    -- still be the seed version — the nightly job creates plenty of those — so
    -- whether it needs writing is read from the template, not assumed.
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
  on conflict (student_id, lot_date) where lot_date is not null do nothing
  returning id into tid;

  -- Lost the race. Report the winner's Lot, and — the part that was missing —
  -- the winner's topic and whether it still needs writing, so the screen can
  -- ask for the written version instead of leaving the student on the seed.
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
end $fn$;

revoke all on function public.claim_lot_template(uuid)            from public, anon, authenticated;
revoke all on function public.ensure_and_claim_lot_template(uuid) from public, anon, authenticated;
revoke all on function public.touch_lot_template(uuid, uuid)      from public, anon, authenticated;
revoke all on function public.save_lot_template(uuid, uuid, text, text, text, text, text, integer, text)
                                                                  from public, anon, authenticated;
revoke all on function public.release_lot_template(uuid, uuid)    from public, anon, authenticated;
revoke all on function public.lot_needs_writer(uuid)              from public, anon, authenticated;
revoke all on function public.create_lot_for(uuid, date)          from public, anon, authenticated;

-- service_role by name — the sweep above strips it too, which is how the first
-- version of this claim came to refuse every caller including the winner.
grant execute on function public.claim_lot_template(uuid)            to service_role;
grant execute on function public.ensure_and_claim_lot_template(uuid) to service_role;
grant execute on function public.touch_lot_template(uuid, uuid)      to service_role;
grant execute on function public.save_lot_template(uuid, uuid, text, text, text, text, text, integer, text)
                                                                     to service_role;
grant execute on function public.release_lot_template(uuid, uuid)    to service_role;
grant execute on function public.lot_needs_writer(uuid)              to service_role;
grant execute on function public.create_lot_for(uuid, date)          to service_role;
