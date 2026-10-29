-- Rollback of 166: restores the 165 (graded every week) bodies and drops lot_mode.
begin;

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

create or replace function public.lot_voice_gate(_voice_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select case when t.id is null or t.source is distinct from 'daily_lot' or t.student_id is distinct from v.student_id
              then jsonb_build_object('daily', false, 'open', true)
              else jsonb_build_object('daily', true,
                     'open', public.lot_state(v.student_id, v.task_id) ->> 'voice_state' = 'open') end
    from public.voice_explanations v left join public.tasks t on t.id = v.task_id
   where v.id = _voice_id;
$fn$;

create or replace function public.my_lot_state(_task_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select public.lot_state(auth.uid(), _task_id)
         || jsonb_build_object('skips_this_week', k.n, 'skip_warning', k.n >= 2)
    from (select count(*) filter (where lm.voice_state = 'skip')::int as n
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
           'skips', (select count(*) from public.lot_marks(auth.uid(), w.from_at, w.to_at) lm where lm.voice_state = 'skip'))
    from public.marks_week_window(auth.uid()) w;
$fn$;

drop function if exists public.lot_mode(uuid, timestamptz);

commit;
notify pgrst, 'reload schema';
