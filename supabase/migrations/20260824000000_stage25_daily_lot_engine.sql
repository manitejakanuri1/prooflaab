-- ============================================================================
-- Stage 25 — the Daily Lot actually arrives.
--
-- Found by testing rather than reading: the whole database held one Lot row,
-- dated four days ago, belonging to one student. my_todays_lot() reads
-- tasks where lot_date = today, and nothing had ever written such a row. So the
-- screen every student lands on said "No Lot for today yet — check back
-- shortly" every single day, forever. The landing page of the product was a
-- promise nothing kept.
--
-- Three more faults found in the same sweep and fixed here:
--
--   * a student could not read a task assigned to them. tasks_read allows the
--     owner, a public task or an admin — an assignment made by the admin
--     screen left the student able to see the assignment row and not the task
--     it points at, so the list rendered nothing.
--   * get_leaderboard ranked every student on the platform together, across
--     colleges. It is SECURITY DEFINER, so RLS never applied to it.
--
-- The engine's shape is deliberate. A Lot is written once per topic and shared
-- by every student who reaches that topic, rather than generated per student
-- per day: at ten thousand students the second design is ten thousand model
-- calls every morning for work that is identical. This one is at most one call
-- per topic, ever — 146 in total — and zero on almost every morning after.
-- ============================================================================


-- ── 1. the written work behind a topic ──────────────────────────────────
create table public.lot_templates (
  level_id         uuid primary key references public.levels(id) on delete cascade,
  title            text not null,
  scenario         text not null,
  code_sample      text,
  source_jd        text,
  difficulty       text not null default 'Medium',
  estimate_minutes integer not null default 20,
  lot_category     text not null default 'technical'
                     check (lot_category in ('technical', 'business', 'pitch')),
  -- 'seed' is the plain version built from the topic itself, which is what a
  -- student gets if they are the first person ever to reach that topic. 'ai' is
  -- the written scenario that replaces it moments later and then serves
  -- everybody who follows.
  origin           text not null default 'seed' check (origin in ('seed', 'ai')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger lot_templates_set_updated_at before update on public.lot_templates
  for each row execute function public.set_updated_at();

alter table public.lot_templates enable row level security;

-- Readable by anyone signed in — it is the work itself, and a student needs to
-- see it. Written only by the writer function, which runs as the service role.
create policy lot_templates_read on public.lot_templates for select to authenticated using (true);
revoke insert, update, delete, truncate on public.lot_templates from anon, authenticated;
grant select on public.lot_templates to authenticated;


-- ── 2. which topic is today's Lot about ─────────────────────────────────
-- This week's plan first, because that is what the roadmap already told the
-- student they were doing — a Lot that contradicts the plan on the same screen
-- is worse than no Lot. Anything they started and left comes before anything
-- new, then the next unfinished rung of their track.
create or replace function public.next_lot_level(_student_id uuid)
returns uuid language sql stable security definer set search_path = public, pg_temp as $fn$
  with track as (
    select track_slug from public.student_tracks
     where student_id = _student_id order by created_at desc limit 1
  ), planned as (
    select p.level_id, p.slot
      from public.student_week_plan p
      left join public.student_levels sl
        on sl.level_id = p.level_id and sl.student_id = _student_id
     where p.student_id = _student_id
       and p.week_start = date_trunc('week', current_date)::date
       and coalesce(sl.status, 'new') not in ('cleared', 'mastered', 'placed')
     order by p.slot
     limit 1
  ), fallback as (
    select l.id as level_id, l.level_number as slot
      from public.levels l
      join track t on t.track_slug = l.track_slug
      left join public.student_levels sl
        on sl.level_id = l.id and sl.student_id = _student_id
     where coalesce(sl.status, 'new') not in ('cleared', 'mastered', 'placed')
     order by l.level_number, l.sub_level
     limit 1
  )
  select coalesce((select level_id from planned), (select level_id from fallback));
$fn$;


-- ── 3. the plain version, so nobody is ever left without work ───────────
-- Not filler: it names the real topic from the real ladder and asks for the
-- two things every Lot asks for. It exists so that being the first student to
-- reach a topic is a slightly plainer Lot rather than an empty screen.
create or replace function public.seed_lot_template(_level_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare l record; where_it_sits text;
begin
  select * into l from public.levels where id = _level_id;
  if l is null then return; end if;

  -- On most rungs the topic title and the skill are the same word, so saying
  -- both produced "…do this: Tailwind. It is part of Tailwind."
  where_it_sits := case
    when l.skill is null or lower(l.skill) = lower(l.title) then ''
    else ' It is part of ' || l.skill || '.' end;

  insert into public.lot_templates
    (level_id, title, scenario, difficulty, estimate_minutes, lot_category, origin)
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
    'seed')
  on conflict (level_id) do nothing;
end $fn$;


-- ── 4. today's Lot for one student ──────────────────────────────────────
-- Idempotent by design: called by the nightly job, by the student's own screen
-- and by anything added later, and the second call of the day does nothing.
create or replace function public.create_lot_for(_student_id uuid, _for_date date default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  d     date := coalesce(_for_date, current_date);
  lvl   uuid;
  tpl   record;
  n     integer;
  tid   uuid;
begin
  select id into tid from public.tasks
   where student_id = _student_id and lot_date = d limit 1;
  if tid is not null then
    return jsonb_build_object('ok', true, 'task_id', tid, 'created', false, 'needs_writer', false);
  end if;

  lvl := public.next_lot_level(_student_id);
  if lvl is null then
    -- No track chosen yet, or every topic finished. Both are real answers, and
    -- neither is an error worth failing a nightly job over.
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


-- ── 5. the student's own screen can ask for it ──────────────────────────
-- my_todays_lot is stable and must stay that way, so the Daily Card calls this
-- first when it finds nothing. A student who signs up at nine in the evening
-- gets today's Lot at nine in the evening, not tomorrow morning.
create or replace function public.create_my_lot()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not signed in'; end if;
  return public.create_lot_for(me, current_date);
end $fn$;


-- ── 6. everybody, every morning ─────────────────────────────────────────
create or replace function public.assign_todays_lots()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare s record; made integer := 0; skipped integer := 0; r jsonb;
begin
  for s in
    select p.id from public.student_profiles p
     where p.status = 'active'
       and exists (select 1 from public.student_tracks t where t.student_id = p.id)
  loop
    r := public.create_lot_for(s.id, current_date);
    if coalesce((r->>'created')::boolean, false) then made := made + 1;
    else skipped := skipped + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'lots_created', made, 'already_had_one', skipped,
                            'ran_at', now());
end $fn$;

revoke all on function public.next_lot_level(uuid)         from public, anon, authenticated;
revoke all on function public.seed_lot_template(uuid)      from public, anon, authenticated;
revoke all on function public.create_lot_for(uuid, date)   from public, anon, authenticated;
revoke all on function public.assign_todays_lots()         from public, anon, authenticated;
revoke all on function public.create_my_lot()              from public, anon;
grant execute on function public.create_my_lot() to authenticated;

-- Ten past midnight, before anybody is awake to find the screen empty.
select cron.schedule('prooflab-daily-lots', '10 0 * * *',
  $cron$ select public.assign_todays_lots(); $cron$);


-- ── 7. a student may read a task assigned to them ───────────────────────
-- Additive: nothing that was readable stops being readable. Without it the
-- admin's Assign screen wrote two rows, the student could read one of them,
-- and the task list rendered empty.
create policy tasks_assigned_read on public.tasks for select to authenticated
  using (exists (select 1 from public.task_assignments a
                  where a.task_id = id and a.student_id = (select auth.uid())));

create index if not exists task_assignments_student_task_idx
  on public.task_assignments (student_id, task_id);


-- ── 8. the leaderboard is a college's leaderboard ───────────────────────
-- It is SECURITY DEFINER, so the row-level rules never applied to it and every
-- college was ranked into one list. A student at one college being told they
-- are 4,318th on a national board they never entered is not motivation.
create or replace function public.get_leaderboard(_limit integer default 100)
returns table (id uuid, full_name text, profile_photo_url text, total_xp integer,
               trust_score numeric, rank bigint)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with me as (
    select college_id from public.student_profiles where id = (select auth.uid())
  )
  select p.id, p.full_name, p.profile_photo_url, p.total_xp, p.trust_score,
         rank() over (order by p.total_xp desc, p.created_at)
  from public.student_profiles p
  where p.status = 'active'
    and (p.college_id is not distinct from (select college_id from me)
         or (select public.is_admin()))
  order by p.total_xp desc, p.created_at
  limit greatest(_limit, 1);
$fn$;

revoke all on function public.get_leaderboard(integer) from public, anon;
grant execute on function public.get_leaderboard(integer) to authenticated;
