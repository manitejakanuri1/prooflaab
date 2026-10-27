-- 149: the season clock has one anchor and one length (owner, 27 Oct 2026, for a one-hour QA season on TEST).
-- seasons.started_at (timestamptz) is the anchor for every week calculation: week number, week start/end,
-- squad week scoring, weekly progress, season end, swap window and match times.
-- app_settings.season_week_minutes sets the week length. Empty (the default, and the REAL website) = 7 days,
-- and every result is what it was before: started_at is starts_on at midnight, the old anchor.
-- app_settings.season_fast_colleges limits the short week to those college ids (comma separated; empty = all).
-- In normal mode the swap window keeps its India-time end.
-- Turn on for TEST only: scripts/dev-tools/staging_fast_season_on.sql. Rollback: migration/149-rollback-season-clock-setting.sql
begin;

create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from public, anon, authenticated;

alter table public.seasons add column if not exists started_at timestamptz;
update public.seasons set started_at = starts_on::timestamptz where started_at is null;

create or replace function public.college_is_fast(_college_id uuid) returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select coalesce((select nullif(trim(value), '')::int > 0 from public.app_settings where key = 'season_week_minutes'), false)
     and coalesce((select nullif(trim(value), '') is null or _college_id::text = any(string_to_array(replace(value, ' ', ''), ','))
                     from public.app_settings where key = 'season_fast_colleges'), true)
$f$;

create or replace function public.season_is_fast(_season_id uuid) returns boolean
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select coalesce((select public.college_is_fast(s.college_id) from public.seasons s where s.id = _season_id), false)
$f$;

create or replace function public.season_week_len(_season_id uuid) returns interval
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select case when public.season_is_fast(_season_id)
              then make_interval(mins => (select trim(value)::int from public.app_settings where key = 'season_week_minutes'))
              else interval '7 days' end
$f$;

-- Matches are played on day 5 of a week at 18:00; in a short week, 60% of the way through it.
create or replace function public.season_match_offset(_season_id uuid) returns interval
language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select case when public.season_is_fast(_season_id) then public.season_week_len(_season_id) * 0.6
              else interval '4 days 18 hours' end
$f$;

create or replace function public.seasons_fill_started_at() returns trigger
language plpgsql set search_path to 'public', 'pg_temp' as $f$
begin
  if tg_op = 'INSERT' and new.started_at is null then
    new.started_at := case when public.college_is_fast(new.college_id) then now() else new.starts_on::timestamptz end;
  elsif tg_op = 'UPDATE' and new.starts_on is distinct from old.starts_on and new.started_at is not distinct from old.started_at then
    new.started_at := new.starts_on::timestamptz;
  end if;
  return new;
end $f$;
drop trigger if exists seasons_fill_started_at on public.seasons;
create trigger seasons_fill_started_at before insert or update of starts_on on public.seasons
  for each row execute function public.seasons_fill_started_at();
alter table public.seasons alter column started_at set not null;

revoke all on function public.college_is_fast(uuid), public.season_is_fast(uuid), public.season_week_len(uuid),
                       public.season_match_offset(uuid) from public, anon;
grant execute on function public.college_is_fast(uuid), public.season_is_fast(uuid), public.season_week_len(uuid),
                          public.season_match_offset(uuid) to authenticated, service_role;

create function pg_temp.swap_text(_fn regprocedure, _old text, _new text, _times integer) returns void
language plpgsql as $sw$
declare def text := pg_get_functiondef(_fn); c integer;
begin
  c := (length(def) - length(replace(def, _old, ''))) / length(_old);
  if c <> _times then raise exception '%: % has % copies of the text to change, expected %', '149', _fn, c, _times; end if;
  execute replace(def, _old, _new);
end $sw$;

select pg_temp.swap_text('public.season_week(uuid)', $o$(floor((current_date - s.starts_on) / 7.0) + 1)::int$o$, $n$(floor(extract(epoch from now() - s.started_at) / extract(epoch from public.season_week_len(s.id))) + 1)::int$n$, 1);
select pg_temp.swap_text('public.season_week_bounds(uuid,integer)', $o$(s.starts_on + ((_week - 1) * 7))::timestamptz$o$, $n$s.started_at + (_week - 1) * public.season_week_len(s.id)$n$, 1);
select pg_temp.swap_text('public.season_week_bounds(uuid,integer)', $o$(s.starts_on + (_week * 7))::timestamptz$o$, $n$s.started_at + _week * public.season_week_len(s.id)$n$, 1);
select pg_temp.swap_text('public.run_squad_week(uuid,integer)', $o$public.season_week_start(_season_id, wk) + interval '7 days'$o$, $n$public.season_week_start(_season_id, wk) + public.season_week_len(_season_id)$n$, 2);
select pg_temp.swap_text('public.notify_weekly_progress()', $o$public.season_week_start(w.season_id, w.week) + interval '7 days'$o$, $n$public.season_week_start(w.season_id, w.week) + public.season_week_len(w.season_id)$n$, 1);
select pg_temp.swap_text('public.run_all_seasons()', $o$current_date >= s.starts_on + s.planned_weeks * 7$o$, $n$now() >= s.started_at + s.planned_weeks * public.season_week_len(s.id)$n$, 1);
select pg_temp.swap_text('public.squad_swap_closes(uuid)', $o$((s.starts_on + 7)::timestamp at time zone 'Asia/Kolkata')$o$, $n$(case when public.season_is_fast(s.id) then s.started_at + public.season_week_len(s.id) else ((s.starts_on + 7)::timestamp at time zone 'Asia/Kolkata') end)$n$, 1);
select pg_temp.swap_text('public.generate_final(uuid)', $o$(starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours'$o$, $n$(public.season_week_start(_season_id, wk) + public.season_match_offset(_season_id))$n$, 1);
select pg_temp.swap_text('public.generate_knockout(uuid)', $o$(starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours'$o$, $n$(public.season_week_start(_season_id, wk) + public.season_match_offset(_season_id))$n$, 2);
select pg_temp.swap_text('public.generate_round_robin(uuid,boolean,integer)', $o$(starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours'$o$, $n$(public.season_week_start(_season_id, wk) + public.season_match_offset(_season_id))$n$, 1);
select pg_temp.swap_text('public.schedule_round_robin(uuid,uuid[],integer,integer,text,text)', $o$(starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours'$o$, $n$(public.season_week_start(_season_id, wk) + public.season_match_offset(_season_id))$n$, 1);

do $$
begin
  if exists (select 1 from public.app_settings where key = 'season_week_minutes' and nullif(trim(value), '') is not null) then
    return;  -- a database already on short weeks: the comparison below is about normal weeks
  end if;
  if exists (select 1 from public.seasons s
              where public.season_week(s.id) <> greatest(1, least(s.planned_weeks, (floor((current_date - s.starts_on) / 7.0) + 1)::int))) then
    raise exception '149 self-check: a season week number changed in normal mode';
  end if;
  if exists (select 1 from public.seasons s, public.season_week_bounds(s.id, 2) b
              where b.starts_at <> (s.starts_on + 7)::timestamptz or b.ends_at <> (s.starts_on + 14)::timestamptz) then
    raise exception '149 self-check: week bounds changed in normal mode';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
