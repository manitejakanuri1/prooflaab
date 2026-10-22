-- ROLLBACK for 132: suggest_tracks back to evidence-first ordering (the goal is no longer read).
begin;
do $$
declare
  f   constant regprocedure := 'public.suggest_tracks(uuid,integer)'::regprocedure;
  def text := pg_get_functiondef(f);
begin
  def := regexp_replace(def, $r$,\s*coalesce\(length\(split_part.*?as goal_match$r$, '', 's');
  def := replace(def, 'order by s.goal_match desc, s.matched_steps desc', 'order by s.matched_steps desc');
  def := replace(def, 'group by t.slug, t.name, t.emoji, t.role, t.sort_order, t.interest', 'group by t.slug, t.name, t.emoji, t.role, t.sort_order');
  execute def;
  if position('goal_match' in pg_get_functiondef(f)) > 0 then raise exception 'rollback 132 failed'; end if;
end $$;
commit;
notify pgrst, 'reload schema';
