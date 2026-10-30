-- Rollback of 187: the report picks the season of the last scored week first again.
begin;
do $$
declare
  f constant regprocedure := 'public.my_season_report(uuid)'::regprocedure;
  def text := pg_get_functiondef(f);
  i int := position('           -- 187 (MF-031)' in def);
  j int := position(E'           (select w.season_id from public.student_weekly_scores w' in def);
begin
  if i = 0 then return; end if;
  execute substr(def, 1, i - 1) || substr(def, j);
end $$;
commit;
