-- 166 (owner + manager, 29 Oct 2026): the graded marks of 165 apply only in week 1 of a season.
-- From week 2 (and for a student in no season) a Daily Lot is strict:
--   coding Lot  = unlimited checks; the voice opens only when ALL tests pass; coding mark 10, else 0.
--                 No "Submit this score". From the 2nd failed check the server shows one failed hidden test per check.
--   written Lot = one check; its rubric score / 10 is final and the voice opens straight after.
--   voice       = score / 10, any score; a bad recording (silent, too short, off-topic) can be recorded once more.
--   day         = coding + voice. Two bad recordings = coding + 0. Nothing finished by the next Lot (or week end) = 0.
--   The weekly skip rule (skips 1-2 keep coding, warning after 2) is week 1 only.
-- A Lot's mode is fixed by its first check (or now, before any check): inside week 1 of a season the student is in.
-- Rollback: migration/166-rollback-strict-after-week-one.sql (restores the 165 bodies, drops lot_mode).
begin;

-- 'graded' inside week 1 of a season the student belongs to, else 'strict'.
create or replace function public.lot_mode(_student_id uuid, _at timestamptz)
returns text language sql stable security definer set search_path = public, pg_temp as $fn$
  select case when exists (
           select 1 from public.squad_members m
             join public.squads q on q.id = m.squad_id
             cross join lateral public.season_week_bounds(q.season_id, 1) b
            where m.student_id = _student_id and _at >= b.starts_at and _at < b.ends_at)
         then 'graded' else 'strict' end;
$fn$;

create or replace function public.lot_marks(_student_id uuid, _from timestamptz, _to timestamptz)
returns table (task_id uuid, lot_at timestamptz, coding_mark numeric, voice_mark numeric,
               voice_state text, skip_no integer, day_total numeric)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with lots as (
    select t.id, t.created_at, min(s.created_at) as lot_at, t.sandbox_config_id is not null as is_coding,
           max(case when t.sandbox_config_id is not null
                    then case when s.total_count > 0 then round(s.passed_count * 10.0 / s.total_count, 1) else 0 end
                    else round(least(100, greatest(0, s.sandbox_score)) / 10.0, 1) end) as best
      from public.tasks t
      join public.task_submissions s on s.task_id = t.id and s.student_id = _student_id
     where t.student_id = _student_id and t.source = 'daily_lot'
     group by t.id, t.created_at
    having min(s.created_at) >= _from and min(s.created_at) < _to
  ), m as (
    select lots.*, public.lot_mode(_student_id, lots.lot_at) as mode from lots
  ), v as (
    select m.*,
           -- strict coding counts only a full pass
           case when m.mode = 'strict' and m.is_coding then case when m.best >= 10 then 10.0 else 0 end
                else m.best end as coding,
           (select round(least(100, greatest(0, ve.communication_score)) / 10.0, 1)
              from public.voice_explanations ve
             where ve.task_id = m.id and ve.student_id = _student_id and ve.status = 'scored' and ve.withdrawn_at is null
             order by ve.created_at limit 1) as voice,
           (select count(*) from public.voice_explanations ve
             where ve.task_id = m.id and ve.student_id = _student_id and ve.status = 'failed'
               and ve.evaluation ->> 'attempt_fail' = 'off_topic') as bad_off,
           (select count(*) from public.voice_explanations ve
             where ve.task_id = m.id and ve.student_id = _student_id and ve.status = 'failed'
               and ve.evaluation ->> 'attempt_fail' in ('silence', 'too_few_words', 'repetitive')) as bad_short,
           (_to <= now() or exists (select 1 from public.tasks n
                                     where n.student_id = _student_id and n.source = 'daily_lot'
                                       and n.created_at > m.created_at)) as past
      from m
  ), st as (
    select v.*,
           case when voice is not null then 'scored'
                when bad_off + bad_short >= 2 and bad_off > 0 then 'tried'
                when bad_off + bad_short >= 2 or past then 'skip'
                else 'open' end as state
      from v
  ), numbered as (
    select st.*,
           case when state = 'skip' and mode = 'graded'
                then (count(*) filter (where state = 'skip' and mode = 'graded')
                        over (order by lot_at, id rows unbounded preceding))::int
           end as skip_n
      from st
  )
  select id, lot_at, coding, coalesce(voice, 0), state, skip_n,
         case when state = 'scored' then coding + voice
              when mode = 'strict' then case when bad_off + bad_short >= 2 then coding else 0 end
              when state = 'skip' then case when skip_n <= 2 then coding else 0 end
              else coding end
    from numbered
   order by lot_at;
$fn$;

create or replace function public.lot_state(_student_id uuid, _task_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  with t0 as (
    select t.id, t.status, t.sandbox_config_id is not null as is_coding
      from public.tasks t where t.id = _task_id and t.student_id = _student_id and t.source = 'daily_lot'
  ), c as (
    select count(*)::int as used, min(s.created_at) as first_at,
           coalesce(max(case when s.sandbox_config_id is not null
                             then case when s.total_count > 0 then round(s.passed_count * 10.0 / s.total_count, 1) else 0 end
                             else round(least(100, greatest(0, s.sandbox_score)) / 10.0, 1) end), 0) as best
      from public.task_submissions s where s.task_id = _task_id and s.student_id = _student_id
  ), t as (
    select t0.*, md.mode,
           case when t0.is_coding then 'coding' else 'written' end as kind,
           -- null = unlimited (strict coding: check until every test passes)
           case when md.mode = 'graded' then case when t0.is_coding then 3 else 2 end
                when t0.is_coding then null else 1 end as max_checks
      from t0 cross join c cross join lateral (select public.lot_mode(_student_id, coalesce(c.first_at, now())) as mode) md
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
           'daily', true, 'kind', t.kind, 'mode', t.mode,
           'checks_used', c.used, 'checks_max', t.max_checks,
           'submitted', t.status in ('pending_voice', 'completed'),
           'checks_left', case when t.status in ('pending_voice', 'completed') then 0
                               when t.max_checks is null then null
                               else greatest(0, t.max_checks - c.used) end,
           'best_mark', case when t.mode = 'strict' and t.is_coding then case when c.best >= 10 then 10 else 0 end
                             else c.best end,
           'voice_mark', v.voice,
           'voice_bad_tries', v.bad,
           'voice_tries_left', case when v.voice is not null then 0 else greatest(0, 2 - v.bad) end,
           'voice_closed', v.voice is null and v.bad >= 2,
           'voice_state', case when v.voice is not null then 'scored'
                               when v.bad >= 2 and v.bad_off > 0 then 'tried'
                               when v.bad >= 2 then 'skip' else 'open' end) end
    from (select 1) one left join t on true cross join c cross join v;
$fn$;

-- "Submit this score" is week 1 only for coding; a strict coding Lot opens the voice only by passing every test
-- (record_task_submission does that). A strict written Lot is submitted by its one check (afterCheck).
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
  if st ->> 'mode' = 'strict' and st ->> 'kind' = 'coding' then
    return st || jsonb_build_object('ok', false, 'reason', 'Pass every test first. Then the voice part opens.');
  end if;
  prev := current_setting('app.system_write', true);
  perform set_config('app.system_write', 'on', true);
  update public.tasks set status = 'pending_voice' where id = _task_id and status not in ('pending_voice', 'completed');
  perform set_config('app.system_write', coalesce(prev, ''), true);
  return public.lot_state(_student_id, _task_id) || jsonb_build_object('ok', true);
end $fn$;

-- No AI spend on a recording before the Lot is submitted (strict coding: before every test passed).
create or replace function public.lot_voice_gate(_voice_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select case when t.id is null or t.source is distinct from 'daily_lot' or t.student_id is distinct from v.student_id
              then jsonb_build_object('daily', false, 'open', true)
              else (select jsonb_build_object('daily', true,
                             'open', st ->> 'voice_state' = 'open' and (st ->> 'submitted')::boolean)
                      from (select public.lot_state(v.student_id, v.task_id) as st) x) end
    from public.voice_explanations v left join public.tasks t on t.id = v.task_id
   where v.id = _voice_id;
$fn$;

-- Skips and the warning count week-1 Lots only (skip_no is null for strict Lots).
create or replace function public.my_lot_state(_task_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select public.lot_state(auth.uid(), _task_id)
         || jsonb_build_object('skips_this_week', k.n, 'skip_warning', k.n >= 2)
    from (select count(*) filter (where lm.skip_no is not null)::int as n
            from public.marks_week_window(auth.uid()) w
            cross join lateral public.lot_marks(auth.uid(), w.from_at, w.to_at) lm) k;
$fn$;

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
           'skips', (select count(*) from public.lot_marks(auth.uid(), w.from_at, w.to_at) lm where lm.skip_no is not null))
    from public.marks_week_window(auth.uid()) w;
$fn$;

revoke all on function public.lot_mode(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.lot_mode(uuid, timestamptz) to service_role;

do $$
begin
  if pg_get_functiondef('public.lot_state(uuid,uuid)'::regprocedure) !~ 'lot_mode'
     or pg_get_functiondef('public.lot_marks(uuid,timestamptz,timestamptz)'::regprocedure) !~ 'lot_mode' then
    raise exception '166: lot_state / lot_marks do not know week 1 from later weeks';
  end if;
  if has_function_privilege('authenticated', 'public.lot_mode(uuid,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.lot_submit(uuid,uuid)', 'execute') then
    raise exception '166: a server-only marks function is open to the browser';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
