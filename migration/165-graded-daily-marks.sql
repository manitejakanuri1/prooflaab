-- 165 (owner plan 29 Oct 2026): graded daily marks replace the flat 20 points per Daily Lot (migration 163).
--   Only Daily Lots score. Each Lot gets two marks out of 10:
--   coding mark  = the best check: tests passed / total tests x 10 (visible and hidden count the same), or for a
--                  written Lot the rubric score / 10. 1 decimal. A coding Lot has 3 checks, a written Lot 2.
--   voice mark   = the one good recording: communication_score / 10 (the off-topic cap of 30 stays in voiceScore.ts).
--                  A bad recording (silent, too few words, repeated words, off-topic) can be recorded again once;
--                  two bad recordings close the voice part of that Lot.
--   day total    = coding + voice (max 20).
--                  Two bad recordings with any off-topic talk = "tried": coding + 0.
--                  No good recording (none, or only silent / too short) = a skip. The first two skips in a week keep
--                  the coding mark, the third and later count 0. A Lot becomes a skip once a newer Daily Lot exists
--                  or its week is over. Each week starts fresh.
--   week         = sum of the day totals, rounded to a whole number for student_weekly_scores (points stay integer
--                  columns); squad = sum of its members. A missed day adds nothing and takes nothing from anyone.
--   Matches where neither squad has points stay 'no_activity' (163, settle_round unchanged).
-- New: table daily_marks (filled by the weekly scoring), lot_marks / lot_state / lot_submit / lot_voice_gate /
-- fail_voice_attempt (server only), my_lot_state / my_marks_week / squad_marks_week / submit_my_lot (signed-in).
-- TEST overlay: scripts/dev-tools/staging_test_week_apply.sql carries run_squad_week too; same body, re-applied there.
-- Rollback: migration/165-rollback-graded-daily-marks.sql
begin;

create table if not exists public.daily_marks (
  task_id     uuid primary key references public.tasks(id) on delete cascade,
  student_id  uuid not null references public.student_profiles(id) on delete cascade,
  season_id   uuid references public.seasons(id) on delete set null,
  week        integer,
  lot_at      timestamptz not null,
  coding_mark numeric(3,1) not null,
  voice_mark  numeric(3,1) not null,
  voice_state text not null check (voice_state in ('scored', 'tried', 'skip', 'open')),
  skip_no     integer,
  day_total   numeric(4,1) not null,
  computed_at timestamptz not null default now()
);
create index if not exists daily_marks_student_idx on public.daily_marks (student_id, lot_at desc);
alter table public.daily_marks enable row level security;
drop policy if exists daily_marks_own on public.daily_marks;
create policy daily_marks_own on public.daily_marks for select to authenticated using (student_id = auth.uid());
revoke all on public.daily_marks from anon;
grant select on public.daily_marks to authenticated;

-- Every Daily Lot of one student whose first check falls in [_from, _to), with its marks.
create or replace function public.lot_marks(_student_id uuid, _from timestamptz, _to timestamptz)
returns table (task_id uuid, lot_at timestamptz, coding_mark numeric, voice_mark numeric,
               voice_state text, skip_no integer, day_total numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with lots as (
    select t.id, t.created_at, min(s.created_at) as lot_at,
           max(case when t.sandbox_config_id is not null
                    then case when s.total_count > 0 then round(s.passed_count * 10.0 / s.total_count, 1) else 0 end
                    else round(least(100, greatest(0, s.sandbox_score)) / 10.0, 1) end) as coding
      from public.tasks t
      join public.task_submissions s on s.task_id = t.id and s.student_id = _student_id
     where t.student_id = _student_id and t.source = 'daily_lot'
     group by t.id, t.created_at
    having min(s.created_at) >= _from and min(s.created_at) < _to
  ), v as (
    select l.*,
           (select round(least(100, greatest(0, ve.communication_score)) / 10.0, 1)
              from public.voice_explanations ve
             where ve.task_id = l.id and ve.student_id = _student_id and ve.status = 'scored' and ve.withdrawn_at is null
             order by ve.created_at limit 1) as voice,
           (select count(*) from public.voice_explanations ve
             where ve.task_id = l.id and ve.student_id = _student_id and ve.status = 'failed'
               and ve.evaluation ->> 'attempt_fail' = 'off_topic') as bad_off,
           (select count(*) from public.voice_explanations ve
             where ve.task_id = l.id and ve.student_id = _student_id and ve.status = 'failed'
               and ve.evaluation ->> 'attempt_fail' in ('silence', 'too_few_words', 'repetitive')) as bad_short,
           (_to <= now() or exists (select 1 from public.tasks n
                                     where n.student_id = _student_id and n.source = 'daily_lot'
                                       and n.created_at > l.created_at)) as past
      from lots l
  ), st as (
    select v.*,
           case when voice is not null then 'scored'
                when bad_off + bad_short >= 2 and bad_off > 0 then 'tried'
                when bad_off + bad_short >= 2 or past then 'skip'
                else 'open' end as state
      from v
  ), numbered as (
    select st.*,
           case when state = 'skip'
                then (count(*) filter (where state = 'skip') over (order by lot_at, id rows unbounded preceding))::int
           end as skip_n
      from st
  )
  select id, lot_at, coding, coalesce(voice, 0), state, skip_n,
         case state when 'scored' then coding + voice
                    when 'skip' then case when skip_n <= 2 then coding else 0 end
                    else coding end
    from numbered
   order by lot_at;
$fn$;

-- One Lot's state for the task screen and the server: checks used / left, best mark, voice tries.
create or replace function public.lot_state(_student_id uuid, _task_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  with t as (
    select t.id, t.status, case when t.sandbox_config_id is not null then 'coding' else 'written' end as kind,
           case when t.sandbox_config_id is not null then 3 else 2 end as max_checks
      from public.tasks t where t.id = _task_id and t.student_id = _student_id and t.source = 'daily_lot'
  ), c as (
    select count(*)::int as used,
           coalesce(max(case when s.sandbox_config_id is not null
                             then case when s.total_count > 0 then round(s.passed_count * 10.0 / s.total_count, 1) else 0 end
                             else round(least(100, greatest(0, s.sandbox_score)) / 10.0, 1) end), 0) as best
      from public.task_submissions s where s.task_id = _task_id and s.student_id = _student_id
  ), v as (
    select (select round(least(100, greatest(0, ve.communication_score)) / 10.0, 1) from public.voice_explanations ve
             where ve.task_id = _task_id and ve.student_id = _student_id and ve.status = 'scored' and ve.withdrawn_at is null
             order by ve.created_at limit 1) as voice,
           (select count(*)::int from public.voice_explanations ve
             where ve.task_id = _task_id and ve.student_id = _student_id and ve.status = 'failed'
               and ve.evaluation ->> 'attempt_fail' in ('silence', 'too_few_words', 'repetitive', 'off_topic')) as bad,
           (select count(*)::int from public.voice_explanations ve
             where ve.task_id = _task_id and ve.student_id = _student_id and ve.status = 'failed'
               and ve.evaluation ->> 'attempt_fail' = 'off_topic') as bad_off
  )
  select case when t.id is null then jsonb_build_object('daily', false) else jsonb_build_object(
           'daily', true, 'kind', t.kind,
           'checks_used', c.used, 'checks_max', t.max_checks,
           'submitted', t.status in ('pending_voice', 'completed'),
           'checks_left', case when t.status in ('pending_voice', 'completed') then 0 else greatest(0, t.max_checks - c.used) end,
           'best_mark', c.best,
           'voice_mark', v.voice,
           'voice_bad_tries', v.bad,
           'voice_tries_left', case when v.voice is not null then 0 else greatest(0, 2 - v.bad) end,
           'voice_closed', v.voice is null and v.bad >= 2,
           'voice_state', case when v.voice is not null then 'scored'
                               when v.bad >= 2 and v.bad_off > 0 then 'tried'
                               when v.bad >= 2 then 'skip' else 'open' end) end
    from (select 1) one left join t on true cross join c cross join v;
$fn$;

-- "Submit this score": the best check counts and the recorder opens, whatever the score (0 included).
create or replace function public.lot_submit(_student_id uuid, _task_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare st jsonb := public.lot_state(_student_id, _task_id); prev text;
begin
  if not coalesce((st ->> 'daily')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'not a Daily Lot of this student');
  end if;
  if (st ->> 'submitted')::boolean then return st || jsonb_build_object('ok', true); end if;
  if (st ->> 'checks_used')::int < 1 then
    return st || jsonb_build_object('ok', false, 'reason', 'Check your answer at least once first.');
  end if;
  prev := current_setting('app.system_write', true);
  perform set_config('app.system_write', 'on', true);
  update public.tasks set status = 'pending_voice' where id = _task_id and status not in ('pending_voice', 'completed');
  perform set_config('app.system_write', coalesce(prev, ''), true);
  return public.lot_state(_student_id, _task_id) || jsonb_build_object('ok', true);
end $fn$;

-- Before any AI spend on a recording: may this Lot's voice still be scored?
create or replace function public.lot_voice_gate(_voice_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select case when t.id is null or t.source is distinct from 'daily_lot' or t.student_id is distinct from v.student_id
              then jsonb_build_object('daily', false, 'open', true)
              else jsonb_build_object('daily', true,
                     'open', public.lot_state(v.student_id, v.task_id) ->> 'voice_state' = 'open') end
    from public.voice_explanations v left join public.tasks t on t.id = v.task_id
   where v.id = _voice_id;
$fn$;

-- A bad recording, with why (counted by lot_state / lot_marks). Fenced on the scoring lease like fail_voice_scoring.
create or replace function public.fail_voice_attempt(_id uuid, _lease_token uuid, _notes text, _reason text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $fn$
declare n integer;
begin
  if _reason not in ('silence', 'too_few_words', 'repetitive', 'off_topic', 'closed') then
    raise exception 'unknown reason %', _reason;
  end if;
  update public.voice_explanations
     set status = 'failed',
         communication_notes = coalesce(_notes, communication_notes),
         evaluation = coalesce(evaluation, '{}'::jsonb) || jsonb_build_object('attempt_fail', _reason),
         scoring_claimed_at = null,
         scoring_lease_token = null
   where id = _id and scoring_lease_token = _lease_token;
  get diagnostics n = row_count;
  return n > 0;
end $fn$;

-- The week the marks belong to: the student's running season week, or Monday-Sunday (India time).
create or replace function public.marks_week_window(_student_id uuid)
returns table (from_at timestamptz, to_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(b.starts_at, w.f), coalesce(b.ends_at, w.f + interval '7 days')
    from (select (date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as f) w
    left join lateral (
      select sb.starts_at, sb.ends_at
        from public.squad_members m
        join public.squads q on q.id = m.squad_id
        join public.seasons s on s.id = q.season_id and s.is_current and s.status = 'active'
        cross join lateral public.season_week_bounds(s.id, public.season_week(s.id)) sb
       where m.student_id = _student_id and m.left_at is null
       limit 1) b on true;
$fn$;

create or replace function public.my_lot_state(_task_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select public.lot_state(auth.uid(), _task_id)
         || jsonb_build_object('skips_this_week', k.n, 'skip_warning', k.n >= 2)
    from (select count(*) filter (where lm.voice_state = 'skip')::int as n
            from public.marks_week_window(auth.uid()) w
            cross join lateral public.lot_marks(auth.uid(), w.from_at, w.to_at) lm) k;
$fn$;

create or replace function public.submit_my_lot(_task_id uuid)
returns jsonb language sql security definer set search_path = public, pg_temp as $fn$
  select public.lot_submit(auth.uid(), _task_id);
$fn$;

-- The dashboard: this week's Lots with their marks, the week total and the skip warning.
create or replace function public.my_marks_week()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select jsonb_build_object(
           'from', w.from_at, 'to', w.to_at,
           'days', coalesce((select jsonb_agg(jsonb_build_object(
                      'task_id', lm.task_id, 'lot_at', lm.lot_at, 'coding_mark', lm.coding_mark,
                      'voice_mark', lm.voice_mark, 'voice_state', lm.voice_state, 'skip_no', lm.skip_no,
                      'day_total', lm.day_total) order by lm.lot_at)
                      from public.lot_marks(auth.uid(), w.from_at, w.to_at) lm), '[]'::jsonb),
           'week_total', coalesce((select sum(lm.day_total) from public.lot_marks(auth.uid(), w.from_at, w.to_at) lm), 0),
           'skips', (select count(*) from public.lot_marks(auth.uid(), w.from_at, w.to_at) lm where lm.voice_state = 'skip'))
    from public.marks_week_window(auth.uid()) w;
$fn$;

-- The squad page: each member's week total and the squad total (members of that squad, or its college's staff).
create or replace function public.squad_marks_week(_squad_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare sq uuid := _squad_id; f timestamptz; t timestamptz; result jsonb;
begin
  if sq is null then
    select m.squad_id into sq from public.squad_members m
      join public.squads q on q.id = m.squad_id and q.archived_at is null
     where m.student_id = auth.uid() and m.left_at is null limit 1;
  end if;
  if sq is null then return null; end if;
  if not exists (select 1 from public.squad_members m where m.squad_id = sq and m.student_id = auth.uid() and m.left_at is null)
     and not (exists (select 1 from public.squads q where q.id = sq and q.college_id = public.my_college_id())
              and not exists (select 1 from public.student_profiles p where p.id = auth.uid())) then
    return null;
  end if;
  select sb.starts_at, sb.ends_at into f, t
    from public.squads q join public.seasons s on s.id = q.season_id
    cross join lateral public.season_week_bounds(s.id, public.season_week(s.id)) sb
   where q.id = sq;
  if f is null then
    f := date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
    t := f + interval '7 days';
  end if;
  select jsonb_build_object('squad_id', sq, 'from', f, 'to', t,
           'squad_total', coalesce(sum(x.total), 0),
           'members', coalesce(jsonb_agg(jsonb_build_object(
                         'student_id', x.student_id, 'full_name', x.full_name, 'week_total', x.total,
                         'lots', x.lots, 'is_me', x.student_id = auth.uid())
                       order by x.total desc, x.full_name), '[]'::jsonb))
    into result
    from (select m.student_id, p.full_name,
                 coalesce((select sum(lm.day_total) from public.lot_marks(m.student_id, f, t) lm), 0) as total,
                 (select count(*) from public.lot_marks(m.student_id, f, t) lm) as lots
            from public.squad_members m join public.student_profiles p on p.id = m.student_id
           where m.squad_id = sq and m.left_at is null) x;
  return result;
end $fn$;

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
  w_start timestamptz; w_end timestamptz;
begin
  select b.starts_at, b.ends_at into w_start, w_end from public.season_week_bounds(_season_id, wk) b;
  -- 165 (owner 29 Oct 2026): graded daily marks. Each Daily Lot = coding mark + voice mark (lot_marks);
  -- the week is their sum, rounded to a whole number. A missed day adds nothing and takes nothing from anyone.
  insert into public.daily_marks
    (task_id, student_id, season_id, week, lot_at, coding_mark, voice_mark, voice_state, skip_no, day_total, computed_at)
  select lm.task_id, m.student_id, _season_id, wk, lm.lot_at, lm.coding_mark, lm.voice_mark, lm.voice_state,
         lm.skip_no, lm.day_total, now()
    from public.squad_members m
    join public.squads q on q.id = m.squad_id and q.season_id = _season_id
    cross join lateral public.lot_marks(m.student_id, w_start, w_end) lm
   where m.left_at is null
  on conflict (task_id) do update set
    season_id = excluded.season_id, week = excluded.week, lot_at = excluded.lot_at,
    coding_mark = excluded.coding_mark, voice_mark = excluded.voice_mark, voice_state = excluded.voice_state,
    skip_no = excluded.skip_no, day_total = excluded.day_total, computed_at = now();

  insert into public.student_weekly_scores
    (season_id, student_id, squad_id, week, points, breakdown)
  select _season_id, m.student_id, m.squad_id, wk, round(d.total)::int,
         case when d.n > 0 then jsonb_build_object('lots', d.n, 'marks', d.total) else '{}'::jsonb end
    from public.squad_members m
    join public.squads q on q.id = m.squad_id and q.season_id = _season_id
    cross join lateral (
      select coalesce(sum(lm.day_total), 0) as total, count(*)::int as n
        from public.lot_marks(m.student_id, w_start, w_end) lm
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

-- The college Scoring card: the marks are fixed now, so there is no weight to change.
CREATE OR REPLACE FUNCTION public.tpo_scoring_rules()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select '[]'::jsonb;
$function$;

revoke all on function public.lot_marks(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.lot_state(uuid, uuid) from public, anon, authenticated;
revoke all on function public.lot_submit(uuid, uuid) from public, anon, authenticated;
revoke all on function public.lot_voice_gate(uuid) from public, anon, authenticated;
revoke all on function public.fail_voice_attempt(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.marks_week_window(uuid) from public, anon, authenticated;
grant execute on function public.lot_marks(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.lot_state(uuid, uuid) to service_role;
grant execute on function public.lot_submit(uuid, uuid) to service_role;
grant execute on function public.lot_voice_gate(uuid) to service_role;
grant execute on function public.fail_voice_attempt(uuid, uuid, text, text) to service_role;
grant execute on function public.marks_week_window(uuid) to service_role;
revoke all on function public.my_lot_state(uuid) from public, anon;
revoke all on function public.submit_my_lot(uuid) from public, anon;
revoke all on function public.my_marks_week() from public, anon;
revoke all on function public.squad_marks_week(uuid) from public, anon;
grant execute on function public.my_lot_state(uuid) to authenticated;
grant execute on function public.submit_my_lot(uuid) to authenticated;
grant execute on function public.my_marks_week() to authenticated;
grant execute on function public.squad_marks_week(uuid) to authenticated;

do $$
begin
  if pg_get_functiondef('public.run_squad_week(uuid,integer)'::regprocedure) !~ 'lot_marks' then
    raise exception '165: run_squad_week still counts flat Lots';
  end if;
  if has_function_privilege('authenticated', 'public.lot_submit(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.lot_marks(uuid,timestamptz,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.my_marks_week()', 'execute') then
    raise exception '165: a server-only marks function is open to the browser';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
