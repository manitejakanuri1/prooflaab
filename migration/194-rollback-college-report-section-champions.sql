-- Rollback of 194: the college report's seasons lose year group and section champions again (text swap back).
begin;
do $$
declare
  def text := pg_get_functiondef('public.tpo_college_report()'::regprocedure);
  i int := position(E',\n           ''year_group_label'', coalesce(public.year_group_label(s.year_group)' in def);
  j int;
begin
  if i = 0 then return; end if;
  j := position('where sc.season_id = s.id))' in def);
  execute substr(def, 1, i - 1) || ')' || substr(def, j + length('where sc.season_id = s.id))'));
end $$;
commit;
