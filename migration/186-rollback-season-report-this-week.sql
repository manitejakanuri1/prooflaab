-- Rollback of 186: remove 'this_week' from my_season_report.
begin;
do $$
declare
  f constant regprocedure := 'public.my_season_report(uuid)'::regprocedure;
  def text := pg_get_functiondef(f);
  i int := position('    -- 186 (MF-031)' in def);
  j int := position(E'    ''rank'', jsonb_build_object(' in def);
begin
  if i = 0 then return; end if;
  execute substr(def, 1, i - 1) || substr(def, j);
end $$;
commit;
