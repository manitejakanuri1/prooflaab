-- ROLLBACK for 149: weeks are 7 days from starts_on again; the setting, anchor column and helpers are removed.
begin;
create function pg_temp.swap_text(_fn regprocedure, _old text, _new text, _times integer) returns void
language plpgsql as $sw$
declare def text := pg_get_functiondef(_fn); c integer;
begin
  c := (length(def) - length(replace(def, _old, ''))) / length(_old);
  if c <> _times then raise exception '%: % has % copies of the text to change, expected %', 'rollback 149', _fn, c, _times; end if;
  execute replace(def, _old, _new);
end $sw$;

select pg_temp.swap_text('public.season_week(uuid)', $o$(floor(extract(epoch from now() - s.started_at) / extract(epoch from public.season_week_len(s.id))) + 1)::int$o$, $n$(floor((current_date - s.starts_on) / 7.0) + 1)::int$n$, 1);
select pg_temp.swap_text('public.season_week_bounds(uuid,integer)', $o$s.started_at + (_week - 1) * public.season_week_len(s.id)$o$, $n$(s.starts_on + ((_week - 1) * 7))::timestamptz$n$, 1);
select pg_temp.swap_text('public.season_week_bounds(uuid,integer)', $o$s.started_at + _week * public.season_week_len(s.id)$o$, $n$(s.starts_on + (_week * 7))::timestamptz$n$, 1);
select pg_temp.swap_text('public.run_squad_week(uuid,integer)', $o$public.season_week_start(_season_id, wk) + public.season_week_len(_season_id)$o$, $n$public.season_week_start(_season_id, wk) + interval '7 days'$n$, 2);
select pg_temp.swap_text('public.notify_weekly_progress()', $o$public.season_week_start(w.season_id, w.week) + public.season_week_len(w.season_id)$o$, $n$public.season_week_start(w.season_id, w.week) + interval '7 days'$n$, 1);
select pg_temp.swap_text('public.run_all_seasons()', $o$now() >= s.started_at + s.planned_weeks * public.season_week_len(s.id)$o$, $n$current_date >= s.starts_on + s.planned_weeks * 7$n$, 1);
select pg_temp.swap_text('public.squad_swap_closes(uuid)', $o$(case when public.season_is_fast(s.id) then s.started_at + public.season_week_len(s.id) else ((s.starts_on + 7)::timestamp at time zone 'Asia/Kolkata') end)$o$, $n$((s.starts_on + 7)::timestamp at time zone 'Asia/Kolkata')$n$, 1);
select pg_temp.swap_text('public.generate_final(uuid)', $o$(public.season_week_start(_season_id, wk) + public.season_match_offset(_season_id))$o$, $n$(starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours'$n$, 1);
select pg_temp.swap_text('public.generate_knockout(uuid)', $o$(public.season_week_start(_season_id, wk) + public.season_match_offset(_season_id))$o$, $n$(starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours'$n$, 2);
select pg_temp.swap_text('public.generate_round_robin(uuid,boolean,integer)', $o$(public.season_week_start(_season_id, wk) + public.season_match_offset(_season_id))$o$, $n$(starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours'$n$, 1);
select pg_temp.swap_text('public.schedule_round_robin(uuid,uuid[],integer,integer,text,text)', $o$(public.season_week_start(_season_id, wk) + public.season_match_offset(_season_id))$o$, $n$(starts + ((wk - 1) * 7) + 4)::timestamptz + interval '18 hours'$n$, 1);
drop trigger if exists seasons_fill_started_at on public.seasons;
drop function if exists public.seasons_fill_started_at();
drop function if exists public.season_match_offset(uuid);
drop function if exists public.season_week_len(uuid);
drop function if exists public.season_is_fast(uuid);
drop function if exists public.college_is_fast(uuid);
alter table public.seasons drop column if exists started_at;
drop table if exists public.app_settings;
commit;

notify pgrst, 'reload schema';
