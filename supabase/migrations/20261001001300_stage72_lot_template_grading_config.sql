-- stage72: wire sandbox_config_id/rubric_config_id through the Lot pipeline
--
-- lot_templates already had sandbox_config_id/rubric_config_id columns from
-- stage69/70, but nothing actually copied them onto a real task:
--   - save_lot_template() never accepted them as params
--   - seed_lot_template() never set one on the instant placeholder
--   - create_lot_for() never copied one onto tasks, in either the retarget
--     UPDATE or the fresh INSERT
-- so even a fully auto-graded lot_templates row would silently fall through
-- to proof_uploads once handed to a student. This closes that gap.

create or replace function public.save_lot_template(
  _level_id uuid,
  _token uuid,
  _title text,
  _scenario text,
  _code_sample text,
  _source_jd text,
  _difficulty text,
  _estimate_minutes integer,
  _lot_category text,
  _sandbox_config_id uuid default null,
  _rubric_config_id uuid default null
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with saved as (
    update public.lot_templates
       set title = _title, scenario = _scenario, code_sample = _code_sample,
           source_jd = _source_jd, difficulty = _difficulty,
           estimate_minutes = _estimate_minutes, lot_category = _lot_category,
           sandbox_config_id = _sandbox_config_id, rubric_config_id = _rubric_config_id,
           origin = 'ai', generating_since = null, generating_by = null,
           updated_at = now()
     where level_id = _level_id and generating_by = _token
    returning 1
  )
  select exists (select 1 from saved);
$$;

grant execute on function public.save_lot_template(uuid, uuid, text, text, text, text, text, integer, text, uuid, uuid)
  to service_role;

comment on function public.save_lot_template(uuid, uuid, text, text, text, text, text, integer, text, uuid, uuid) is
  'Writes lot-writer''s generated scenario AND its validated grading config (sandbox or rubric) onto a claimed lot_templates row. Fenced on the claim token so a caller whose lease lapsed cannot overwrite whatever replaced it.';

create or replace function public.seed_lot_template(_level_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l record;
  where_it_sits text;
  fallback_rubric uuid;
begin
  select * into l from public.levels where id = _level_id;
  if l is null then return; end if;

  select id into fallback_rubric from public.task_rubric_config where is_generic_fallback limit 1;

  where_it_sits := case
    when l.skill is null or lower(l.skill) = lower(l.title) then ''
    else ' It is part of ' || l.skill || '.' end;

  insert into public.lot_templates
    (level_id, title, scenario, difficulty, estimate_minutes, lot_category, origin, rubric_config_id)
  values (
    _level_id,
    l.title,
    'Build the smallest working thing that proves you can do ' || l.title || '.' ||
      where_it_sits ||
      ' Submit what you built, then record sixty seconds explaining why your ' ||
      'approach is right and what you would do differently with more time.',
    case when l.level_number <= 40 then 'Easy'
         when l.level_number <= 100 then 'Medium'
         else 'Hard' end,
    case when l.level_number <= 40 then 15
         when l.level_number <= 100 then 25
         else 40 end,
    case when l.kind = 'explanation' then 'pitch' else 'technical' end,
    'seed',
    -- Auto-graded from the first moment a student sees this topic, via the
    -- generic fallback, until lot-writer overwrites it with a real config.
    -- Never proof_uploads.
    fallback_rubric)
  on conflict (level_id) do nothing;
end $$;

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

    prev := current_setting('app.system_write', true);
    perform set_config('app.system_write', 'on', true);
    update public.tasks
       set level_id = lvl, title = tpl.title, description = tpl.scenario,
           code_sample = tpl.code_sample, source_jd = tpl.source_jd,
           difficulty = tpl.difficulty, estimate_minutes = tpl.estimate_minutes,
           lot_category = tpl.lot_category, is_ai_generated = tpl.origin = 'ai',
           xp_reward = tpl.xp_reward,
           sandbox_config_id = tpl.sandbox_config_id, rubric_config_id = tpl.rubric_config_id
     where id = cur.id;
    perform set_config('app.system_write', coalesce(prev, ''), true);

    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'retargeted', true, 'level_id', lvl,
                              'needs_writer', tpl.origin = 'seed');
  end if;

  lvl := public.next_lot_level(_student_id);
  if lvl is null then
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
     xp_reward, sandbox_config_id, rubric_config_id)
  values
    (_student_id, tpl.title, tpl.scenario, tpl.code_sample, tpl.source_jd, tpl.difficulty,
     tpl.estimate_minutes, tpl.lot_category, n, d, lvl,
     'pending', 'private', (d + 1)::timestamptz - interval '1 second',
     tpl.origin = 'ai', 'system', 'daily_lot',
     tpl.xp_reward, tpl.sandbox_config_id, tpl.rubric_config_id)
  on conflict (student_id, lot_date) where lot_date is not null do nothing
  returning id into tid;

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

-- Grants unchanged from before this migration: create_lot_for is
-- service_role-only (called from an edge function, never directly by a
-- student's own session), and seed_lot_template has no explicit grant at
-- all — it's only ever invoked internally, from inside create_lot_for,
-- which runs as its SECURITY DEFINER owner. Restating either here would be
-- a real permissions change, not a no-op, so neither is restated.

comment on function public.create_lot_for(uuid, date) is
  'Hands a student their day''s Lot, creating or retargeting the task row. Now copies sandbox_config_id/rubric_config_id from lot_templates so an auto-graded topic reaches the student auto-graded, not via proof_uploads. Column writes for xp_reward/sandbox_config_id/rubric_config_id are fenced through app.system_write since protect_tasks guards them from a plain authenticated caller.';
