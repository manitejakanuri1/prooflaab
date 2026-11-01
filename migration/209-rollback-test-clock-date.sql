-- Rollback of 209 (TEST only): every function back on the real date and time, test clock removed.
begin;
do $$
declare f record; def text;
begin
  for f in select p.oid from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosrc ~ 'public\.test_(now|today)\(\)'
              and p.proname not in ('test_now', 'test_today', 'admin_test_clock', 'admin_test_clock_set', 'admin_test_make_lots') loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'public.test_today()', 'current_date');
    def := replace(def, 'public.test_now()', 'now()');
    execute def;
  end loop;
end $$;
drop function if exists public.admin_test_make_lots();
drop function if exists public.admin_test_clock_set(timestamptz);
drop function if exists public.admin_test_clock();
drop function if exists public.test_today();
drop function if exists public.test_now();
drop table if exists public.test_clock;
notify pgrst, 'reload schema';
commit;
