-- stage75: fully decouple Lots from Tracks
--
-- Tracks and Lots were meant to be two independent systems. Stage68 wired
-- them together instead: every Lot was generated FOR a specific Track level,
-- the daily pick walked the student's Track unlock wall and weekly plan, the
-- nightly job skipped any student with no Track at all, and the card showed
-- "Track · Level N of M" / "Practice for Level N". None of that belongs.
--
-- A Lot is "today's real question" — sourced from source_content (the
-- crawler's own pages, or something a college submitted), or a real job
-- posting when one matches. It has nothing to do with a student's Track
-- level, ever. Tracks keep their own levels/checkpoints/Level Map/weekly
-- plan (student_tracks, student_levels, student_week_plan, my_week()) —
-- none of that is touched here.
--
-- lot_templates.level_id is NOT dropped: those ~197 already-AI-written Lots
-- are real content someone paid a model call for, no reason to lose them.
-- It stops being the table's primary key (a surrogate id takes over) and
-- stops being what new rows are keyed on — source_content_id is the new key.

alter table public.lot_templates add column id uuid not null default gen_random_uuid();
alter table public.lot_templates drop constraint lot_templates_pkey;
alter table public.lot_templates add constraint lot_templates_pkey primary key (id);
alter table public.lot_templates add constraint lot_templates_level_id_key unique (level_id);
alter table public.lot_templates alter column level_id drop not null;
alter table public.lot_templates add column source_content_id uuid references public.source_content(id) on delete cascade;
alter table public.lot_templates add constraint lot_templates_source_content_id_key unique (source_content_id);

alter table public.tasks add column source_content_id uuid references public.source_content(id);

comment on column public.lot_templates.level_id is
  'stage75: legacy key from when Lots were tied to Track levels. Existing rows kept for their content; no longer written by the Lot pipeline. Use source_content_id.';
comment on column public.tasks.level_id is
  'stage75: no longer set by the daily-Lot pipeline (Lots and Tracks are independent). May still be used by roadmap/non-Lot tasks — left alone.';

-- ---------------------------------------------------------------------------
-- lot_templates lifecycle: seed / claim / release / touch / save
-- All five re-keyed from level_id to source_content_id, logic unchanged.
-- ---------------------------------------------------------------------------

drop function if exists public.seed_lot_template(uuid);
create or replace function public.seed_lot_template(_source_content_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  c record;
  fallback_rubric uuid;
begin
  select * into c from public.source_content where id = _source_content_id;
  if c is null then return; end if;

  select id into fallback_rubric from public.task_rubric_config where is_generic_fallback limit 1;

  -- ponytail: seed placeholder has no signal to pick difficulty/category from
  -- (no Track level to bucket by anymore), so it always seeds Medium/technical.
  -- Harmless — this row is overwritten by lot-writer within seconds for the
  -- first real student to reach it; nobody reads the seed for long.
  insert into public.lot_templates
    (source_content_id, title, scenario, difficulty, estimate_minutes, lot_category, origin, rubric_config_id)
  values (
    _source_content_id,
    coalesce(c.title, 'Today''s real question'),
    'Build the smallest working thing that proves you understand ' ||
      coalesce(c.title, 'this') || '. Submit what you built, then record sixty ' ||
      'seconds explaining why your approach is right and what you would do ' ||
      'differently with more time.',
    'Medium',
    20,
    'technical',
    'seed',
    fallback_rubric)
  on conflict (source_content_id) do nothing;
end $function$;

drop function if exists public.claim_lot_template(uuid);
create or replace function public.claim_lot_template(_source_content_id uuid)
returns uuid
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with claimed as (
    update public.lot_templates
       set generating_since = now(), generating_by = gen_random_uuid()
     where source_content_id = _source_content_id
       and origin = 'seed'
       and (generating_since is null or generating_since < now() - interval '2 minutes')
    returning generating_by
  )
  select generating_by from claimed;
$function$;

drop function if exists public.ensure_and_claim_lot_template(uuid);
create or replace function public.ensure_and_claim_lot_template(_source_content_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not exists (select 1 from public.lot_templates where source_content_id = _source_content_id) then
    perform public.seed_lot_template(_source_content_id);
  end if;
  return public.claim_lot_template(_source_content_id);
end $function$;

drop function if exists public.release_lot_template(uuid, uuid);
create or replace function public.release_lot_template(_source_content_id uuid, _token uuid)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  update public.lot_templates
     set generating_since = null, generating_by = null
   where source_content_id = _source_content_id and generating_by = _token;
$function$;

drop function if exists public.touch_lot_template(uuid, uuid);
create or replace function public.touch_lot_template(_source_content_id uuid, _token uuid)
returns boolean
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with beat as (
    update public.lot_templates set generating_since = now()
     where source_content_id = _source_content_id and generating_by = _token
    returning 1
  )
  select exists (select 1 from beat);
$function$;

-- Same 11-arg signature as before (config params already added in stage72),
-- only the key column and its param name change.
drop function if exists public.save_lot_template(uuid, uuid, text, text, text, text, text, integer, text, uuid, uuid);
create or replace function public.save_lot_template(
  _source_content_id uuid, _token uuid, _title text, _scenario text, _code_sample text,
  _source_jd text, _difficulty text, _estimate_minutes integer, _lot_category text,
  _sandbox_config_id uuid default null::uuid, _rubric_config_id uuid default null::uuid
)
returns boolean
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with saved as (
    update public.lot_templates
       set title = _title, scenario = _scenario, code_sample = _code_sample,
           source_jd = _source_jd, difficulty = _difficulty,
           estimate_minutes = _estimate_minutes, lot_category = _lot_category,
           sandbox_config_id = _sandbox_config_id, rubric_config_id = _rubric_config_id,
           origin = 'ai', generating_since = null, generating_by = null,
           updated_at = now()
     where source_content_id = _source_content_id and generating_by = _token
    returning 1
  )
  select exists (select 1 from saved);
$function$;

create or replace function public.lot_needs_writer(_task_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce((select t.origin = 'seed'
                     from public.tasks k
                     join public.lot_templates t on t.source_content_id = k.source_content_id
                    where k.id = _task_id), false);
$function$;

-- ---------------------------------------------------------------------------
-- Selection: which piece of real content does a student see today
-- ---------------------------------------------------------------------------

drop function if exists public.next_lot_level(uuid);

create or replace function public.next_lot_source(_student_id uuid)
returns uuid
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with mine as (
    select distinct k.source_content_id
      from public.tasks k
     where k.student_id = _student_id and k.source_content_id is not null
  ),
  my_college as (
    select college_id from public.student_profiles where id = _student_id
  ),
  fresh as (
    -- Never shown to this student before. This student's own college's
    -- submissions first, then any college's submissions, then plain crawled
    -- content — oldest fetched first, so the pool rotates fairly.
    select sc.id
      from public.source_content sc
     where sc.id not in (select source_content_id from mine)
     order by
       (sc.submitted_by_college_id is not null
          and sc.submitted_by_college_id = (select college_id from my_college)) desc,
       (sc.submitted_by_college_id is not null) desc,
       sc.fetched_at asc
     limit 1
  ),
  reuse as (
    -- Pool exhausted for this one student (small pool, will happen):
    -- give back whichever piece they were given longest ago, rather than
    -- leaving them with no Lot at all.
    select sc.id
      from public.source_content sc
      left join public.tasks k
        on k.source_content_id = sc.id and k.student_id = _student_id
     group by sc.id
     order by max(k.lot_date) asc nulls first
     limit 1
  )
  select coalesce((select id from fresh), (select id from reuse));
$function$;

-- ---------------------------------------------------------------------------
-- create_lot_for: no more Track-wall retargeting. Once today's Lot is set,
-- it stays set for the day — there is no wall to move anymore.
-- ---------------------------------------------------------------------------

create or replace function public.create_lot_for(_student_id uuid, _for_date date default null::date)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  d    date := coalesce(_for_date, current_date);
  scid uuid;
  tpl  record;
  n    integer;
  tid  uuid;
  cur  record;
begin
  select t.id, t.source_content_id
    into cur
    from public.tasks t
   where t.student_id = _student_id and t.lot_date = d
   limit 1;

  if cur.id is not null then
    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'source_content_id', cur.source_content_id,
                              'needs_writer', public.lot_needs_writer(cur.id));
  end if;

  scid := public.next_lot_source(_student_id);
  if scid is null then
    return jsonb_build_object('ok', true, 'task_id', null, 'created', false,
      'reason', 'no content available', 'needs_writer', false);
  end if;

  select * into tpl from public.lot_templates where source_content_id = scid;
  if tpl is null then
    perform public.seed_lot_template(scid);
    select * into tpl from public.lot_templates where source_content_id = scid;
  end if;
  if tpl is null then
    return jsonb_build_object('ok', false, 'reason', 'no template', 'needs_writer', false);
  end if;

  select count(*) + 1 into n from public.tasks
   where student_id = _student_id and lot_date is not null;

  insert into public.tasks
    (student_id, title, description, code_sample, source_jd, difficulty,
     estimate_minutes, lot_category, lot_number, lot_date, source_content_id,
     status, visibility, due_date, is_ai_generated, created_by_type, source,
     xp_reward, sandbox_config_id, rubric_config_id)
  values
    (_student_id, tpl.title, tpl.scenario, tpl.code_sample, tpl.source_jd, tpl.difficulty,
     tpl.estimate_minutes, tpl.lot_category, n, d, scid,
     'pending', 'private', (d + 1)::timestamptz - interval '1 second',
     tpl.origin = 'ai', 'system', 'daily_lot',
     tpl.xp_reward, tpl.sandbox_config_id, tpl.rubric_config_id)
  on conflict (student_id, lot_date) where lot_date is not null do nothing
  returning id into tid;

  if tid is null then
    select t.id, t.source_content_id into cur from public.tasks t
     where t.student_id = _student_id and t.lot_date = d limit 1;
    return jsonb_build_object('ok', true, 'task_id', cur.id, 'created', false,
                              'reason', 'another request created it first',
                              'source_content_id', cur.source_content_id,
                              'needs_writer', public.lot_needs_writer(cur.id));
  end if;

  return jsonb_build_object('ok', true, 'task_id', tid, 'created', true,
                            'source_content_id', scid, 'needs_writer', tpl.origin = 'seed');
end
$function$;

-- Nightly cron (00:10) used to skip any student with no Track at all. A Lot
-- no longer has anything to do with a Track, so every active student gets one.
create or replace function public.assign_todays_lots()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare s record; made integer := 0; skipped integer := 0; r jsonb;
begin
  for s in
    select p.id from public.student_profiles p
     where p.status = 'active'
  loop
    r := public.create_lot_for(s.id, current_date);
    if coalesce((r->>'created')::boolean, false) then made := made + 1;
    else skipped := skipped + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'lots_created', made, 'already_had_one', skipped,
                            'ran_at', now());
end $function$;

-- ---------------------------------------------------------------------------
-- my_todays_lot(): plain Lot fields only. No level/track columns, no joins
-- to levels/level_tracks/student_levels/track_phases.
--
-- Also fixes a real, separate bug found while rewriting this: the old
-- version never returned sandbox_config_id/rubric_config_id at all, so
-- every Lot — regardless of whether it had a grading config — showed the
-- proof-upload button on the Daily Card instead of the graded editor. That
-- was never noticed because the auto-grading verification earlier this
-- session went through the assigned-task path (task_assignments), not the
-- daily Lot path.
-- ---------------------------------------------------------------------------

drop function if exists public.my_todays_lot();
create or replace function public.my_todays_lot()
returns table(
  id uuid, lot_number integer, title text, description text, code_sample text,
  source_jd text, difficulty text, estimate_minutes integer, lot_category text,
  status text, due_date timestamp with time zone, sponsored_by_company text,
  sandbox_config_id uuid, rubric_config_id uuid
)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select t.id, t.lot_number, t.title, t.description, t.code_sample, t.source_jd,
         t.difficulty, t.estimate_minutes, t.lot_category, t.status, t.due_date,
         r.company, t.sandbox_config_id, t.rubric_config_id
    from public.tasks t
    left join public.recruiters r on r.id = t.sponsored_by
   where t.student_id = auth.uid() and t.lot_date = current_date
   limit 1;
$function$;
