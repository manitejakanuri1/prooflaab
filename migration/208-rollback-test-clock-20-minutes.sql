-- Rollback of 208 (TEST only): fast clock back to 10 minutes a week, admin button function removed.
begin;
do $$
declare f record; def text;
begin
  for f in select p.oid from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%test_fast_season%'
              and p.proname in ('squad_swap_closes', 'run_all_seasons', 'season_week', 'season_week_bounds',
                                'test_advance_season', 'generate_final', 'generate_knockout', 'generate_round_robin',
                                'generate_section_finals', 'generate_section_knockout') loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'interval ''20 minutes''', 'interval ''10 minutes''');
    def := replace(def, '/ 1200.0)', '/ 600.0)');
    def := replace(def, 'mins => 20 * _weeks', 'mins => 10 * _weeks');
    def := replace(def, 'interval ''12 minutes''', 'interval ''6 minutes''');
    execute def;
  end loop;
end $$;
drop function if exists public.admin_test_advance_season(integer);
notify pgrst, 'reload schema';
commit;
