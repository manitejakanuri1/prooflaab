-- TEST WEBSITE ONLY (owner, 27 Oct 2026): PRAGATI season week = 10 minutes, and PRAGATI Season 1 restarts at week 1.
-- Needs scripts/dev-tools/staging_only_season_clock.sql (TEST only). Undo: scripts/dev-tools/staging_fast_season_off.sql
-- Run: bash scripts/dev-tools/staging_sql.sh scripts/dev-tools/staging_fast_season_on.sql
\set ON_ERROR_STOP on
\pset pager off
\t on
do $$ begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception 'This is not the TEST database. Refusing.'; end if; end $$;
begin;
insert into public.app_settings (key, value) values
  ('season_week_minutes', '10'),
  ('season_fast_colleges', (select string_agg(id::text, ',') from public.colleges where name = 'PRAGATI'))
on conflict (key) do update set value = excluded.value, updated_at = now();

delete from public.squad_matches        where season_id = 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8';
delete from public.squad_weekly_scores  where season_id = 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8';
delete from public.student_weekly_scores where season_id = 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8';
delete from public.squad_swaps          where season_id = 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8';
update public.seasons
   set started_at = now(), starts_on = current_date, status = 'active', is_current = true, completed_at = null,
       champion_squad_id = null, runner_up_squad_id = null, third_squad_id = null
 where id = 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8';
do $$ begin
  if public.season_week('b4d7ee5f-a136-40e1-83cb-2923903bf1e8') <> 1
     or public.season_week_len('b4d7ee5f-a136-40e1-83cb-2923903bf1e8') <> interval '10 minutes' then
    raise exception 'fast season check failed'; end if;
  if exists (select 1 from public.seasons s join public.colleges c on c.id = s.college_id
              where c.name <> 'PRAGATI' and public.season_is_fast(s.id)) then
    raise exception 'another college got the short week'; end if;
end $$;
commit;
select 'ON week=' || public.season_week('b4d7ee5f-a136-40e1-83cb-2923903bf1e8')
    || ' len=' || public.season_week_len('b4d7ee5f-a136-40e1-83cb-2923903bf1e8')
    || ' started=' || to_char(started_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') || ' IST'
    || ' swap_closes=' || coalesce(to_char(public.squad_swap_closes(null), 'HH24:MI'), '-')
  from public.seasons where id = 'b4d7ee5f-a136-40e1-83cb-2923903bf1e8';
