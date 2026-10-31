-- 197 (MF-098, owner 31 Oct 2026): TEST ONLY - move a season forward by whole weeks, for end-to-end testing
--   (handed to Grok). REMOVE AFTER THAT TESTING (owner's instruction): drop public.test_advance_season(uuid, integer).
--   It refuses to run on any database without the TEST admin login (e2e.admin@staging.prooflab.invalid), so on the
--   REAL website it does nothing but raise. No browser role may call it: only the database runner (postgres).
--   What it does: shifts the season's dates (starts_on, ends_on, created_at) and its matches' scheduled_at back by
--   the given weeks (10 minutes per week for a fast TEST season), then runs run_all_seasons() so the weeks that
--   are now over are scored, and knockouts / the final / the close happen as they would on the real clock.
--   Use:  select public.test_advance_season('<season id>', 1);
-- Rollback: migration/197-rollback-test-advance-season.sql
begin;

create or replace function public.test_advance_season(_season_id uuid, _weeks integer default 1)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare step interval; before_week integer; r jsonb;
begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception 'test_advance_season runs only on the TEST database';
  end if;
  if _weeks is null or _weeks < 1 or _weeks > 12 then
    raise exception 'weeks must be 1 to 12';
  end if;
  if not exists (select 1 from public.seasons where id = _season_id) then
    raise exception 'no such season';
  end if;
  before_week := public.season_week(_season_id);
  step := case when public.test_fast_season(_season_id) then make_interval(mins => 10 * _weeks)
               else make_interval(days => 7 * _weeks) end;
  update public.seasons
     set starts_on  = starts_on - (case when public.test_fast_season(_season_id) then 0 else 7 * _weeks end),
         ends_on    = ends_on - (case when public.test_fast_season(_season_id) then 0 else 7 * _weeks end),
         created_at = created_at - step
   where id = _season_id;
  update public.squad_matches set scheduled_at = scheduled_at - step where season_id = _season_id;
  r := to_jsonb(public.run_all_seasons());
  return jsonb_build_object('season_id', _season_id, 'week_before', before_week,
                            'week_now', public.season_week(_season_id), 'run_all_seasons', r);
end $fn$;
revoke all on function public.test_advance_season(uuid, integer) from public, anon, authenticated, service_role;

do $$ begin
  if has_function_privilege('authenticated', 'public.test_advance_season(uuid, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.test_advance_season(uuid, integer)', 'EXECUTE') then
    raise exception '197 self-check: test_advance_season is callable from a browser';
  end if;
end $$;

commit;
