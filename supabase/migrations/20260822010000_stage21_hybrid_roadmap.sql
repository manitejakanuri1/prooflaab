-- ============================================================================
-- Stage 21 — the hybrid roadmap.
--
-- The ladder does not change: twelve tracks, 146 topics, four phases, written
-- once and read by everyone. What changes weekly is which rungs a student is
-- pointed at, and how Foundations is treated.
--
-- Deliberately no AI. Reading last week's results and ordering five topics is
-- arithmetic. Generating a fresh roadmap per student per week would have been
-- ten thousand un-shareable model calls a week at ten thousand students, and it
-- would have destroyed the two things that make a ladder work: a visible
-- destination, and a number that counts up.
--
-- Foundations changes meaning. A resume can prove somebody has used React; it
-- cannot prove they never skipped the basics underneath it, and those gaps are
-- what break students later. So Foundations is no longer ticked off on paper —
-- it becomes a quick revision. Shown, expected, and never a locked door:
-- forcing a strong student to re-prove HTML before they may continue is how you
-- lose them in week one.
-- ============================================================================

comment on column public.student_levels.status is
  'placed  = resume proved it, counts as done (advanced topics only)
   revise  = Foundations the resume suggests they know; shown as a quick
             revision, never blocks anything above it
   opened  = started
   cleared = passed the checkpoint
   mastered= cleared to a high standard';


-- ── what a student is doing this week ───────────────────────────────────
create table public.student_week_plan (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.student_profiles(id) on delete cascade,
  week_start  date not null,
  level_id    uuid not null references public.levels(id) on delete cascade,
  slot        integer not null,
  reason      text not null,
  reason_code text not null check (reason_code in ('retry','revise','next','stretch')),
  created_at  timestamptz not null default now(),
  unique (student_id, week_start, level_id)
);

create index student_week_plan_student_idx
  on public.student_week_plan (student_id, week_start desc, slot);

alter table public.student_week_plan enable row level security;

create policy week_plan_own on public.student_week_plan for select to authenticated
  using (student_id = (select auth.uid())
         or student_id in (select id from public.student_profiles
                            where college_id = (select public.my_college_id()))
         or (select public.is_admin()));

revoke insert, update, delete, truncate on public.student_week_plan from anon, authenticated;
grant select on public.student_week_plan to authenticated;


-- ── the picker ──────────────────────────────────────────────────────────
-- Five picks: enough to be a week's work, few enough to look finishable.
-- Priority is what they abandoned, then Foundations revision, then the next
-- rungs. Revision is capped at two so a week is never all revision — and
-- anything past that cap keeps the revision wording rather than being
-- relabelled "next step", which would have told a student two different things
-- about the same topic.
create or replace function public.plan_student_week(
  _student_id uuid, _week_start date default null
) returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  wk date := coalesce(_week_start, date_trunc('week', current_date)::date);
  track text;
  picked integer := 0;
  r record;
begin
  select track_slug into track from public.student_tracks
   where student_id = _student_id order by created_at desc limit 1;
  if track is null then return 0; end if;

  delete from public.student_week_plan
   where student_id = _student_id and week_start = wk;

  -- Started and left. The thing they are stuck on comes first, because an
  -- unfinished topic is a reason people stop opening the app at all.
  for r in
    select l.id from public.student_levels sl
      join public.levels l on l.id = sl.level_id
     where sl.student_id = _student_id and l.track_slug = track and sl.status = 'opened'
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

create or replace function public.plan_all_weeks()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare s record; total integer := 0; students integer := 0;
begin
  for s in select distinct student_id from public.student_tracks loop
    total := total + public.plan_student_week(s.student_id);
    students := students + 1;
  end loop;
  return jsonb_build_object('ok', true, 'students', students, 'topics_planned', total);
end $fn$;

-- Plans on demand when Monday has not run yet, so a student who joins on a
-- Wednesday gets a week rather than an empty panel.
create or replace function public.my_week()
returns table (level_id uuid, title text, skill text, level_number integer,
               slot integer, reason text, reason_code text, status text)
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare me uuid := (select auth.uid());
        wk date := date_trunc('week', current_date)::date;
        n integer;
begin
  if me is null then return; end if;
  select count(*) into n from public.student_week_plan
   where student_id = me and week_start = wk;
  if n = 0 then perform public.plan_student_week(me, wk); end if;

  return query
    select l.id, l.title, l.skill, l.level_number, p.slot, p.reason, p.reason_code,
           coalesce(sl.status, 'new')
      from public.student_week_plan p
      join public.levels l on l.id = p.level_id
      left join public.student_levels sl
        on sl.level_id = l.id and sl.student_id = me
     where p.student_id = me and p.week_start = wk
     order by p.slot;
end $fn$;

revoke all on function public.plan_student_week(uuid, date) from public, anon, authenticated;
revoke all on function public.plan_all_weeks() from public, anon, authenticated;
revoke all on function public.my_week() from public, anon;
grant execute on function public.my_week() to authenticated;

-- Monday, half an hour after the squad scoring, so the week is planned against
-- results that have already been counted.
select cron.schedule('prooflab-weekly-roadmap-plan', '30 2 * * 1',
  $cron$ select public.plan_all_weeks(); $cron$);
