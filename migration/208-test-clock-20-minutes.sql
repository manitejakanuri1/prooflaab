-- 208 (owner 31 Oct 2026, for Grok's end-to-end test): TEST ONLY. NEVER apply to REAL.
--   1. The PRAGATI fast clock (test_fast_season) goes from 10 to 20 minutes per season week: week length,
--      season close, squad-swap window, match kick-off (6 -> 12 minutes into the week), and test_advance_season's step.
--   2. admin_test_advance_season(_weeks): an admin-only button on TEST moves every open PRAGATI season forward.
-- Refuses to run unless the TEST admin login exists (same guard as 197). REMOVE with 197 after Grok's testing:
-- migration/208-rollback-test-clock-20-minutes.sql
begin;

do $$ begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception '208 is TEST-only';
  end if;
end $$;

do $$
declare f record; def text; n int := 0;
begin
  for f in select p.oid, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%test_fast_season%'
              and p.proname in ('squad_swap_closes', 'run_all_seasons', 'season_week', 'season_week_bounds',
                                'test_advance_season', 'generate_final', 'generate_knockout', 'generate_round_robin',
                                'generate_section_finals', 'generate_section_knockout') loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'interval ''10 minutes''', 'interval ''20 minutes''');
    def := replace(def, '/ 600.0)', '/ 1200.0)');
    def := replace(def, 'mins => 10 * _weeks', 'mins => 20 * _weeks');
    def := replace(def, 'interval ''6 minutes''', 'interval ''12 minutes''');
    execute def;
    n := n + 1;
  end loop;
  if n < 6 then raise exception '208: only % fast-clock functions found', n; end if;
end $$;

create or replace function public.admin_test_advance_season(_weeks integer default 1)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare s record; out jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception 'TEST only';
  end if;
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin') then
    raise exception 'admins only';
  end if;
  for s in select se.id from public.seasons se join public.colleges c on c.id = se.college_id
            where c.name = 'PRAGATI' and se.status <> 'complete' loop
    out := out || public.test_advance_season(s.id, _weeks);
  end loop;
  return jsonb_build_object('seasons', out);
end $fn$;
revoke all on function public.admin_test_advance_season(integer) from public, anon;
grant execute on function public.admin_test_advance_season(integer) to authenticated;

do $$ declare src text; begin
  select prosrc into src from pg_proc where proname = 'season_week' and pronamespace = 'public'::regnamespace;
  if src not like '%1200.0%' then raise exception '208 self-check: season_week still on 10 minutes'; end if;
  select prosrc into src from pg_proc where proname = 'season_week_bounds' and pronamespace = 'public'::regnamespace;
  if src like '%''10 minutes''%' then raise exception '208 self-check: season_week_bounds still on 10 minutes'; end if;
end $$;

notify pgrst, 'reload schema';
commit;
