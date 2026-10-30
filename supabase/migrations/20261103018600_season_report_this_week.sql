-- 186 (MF-031): the season report counted only weeks that were already scored, so an active student saw 0
-- until the week closed. It now also returns 'this_week': the running week's marks so far, read live from
-- lot_marks (the same marks the weekly scoring adds up). Text swap; the rest of the function is unchanged.
-- Rollback: migration/186-rollback-season-report-this-week.sql
begin;
do $$
declare
  f constant regprocedure := 'public.my_season_report(uuid)'::regprocedure;
  anchor constant text := E'    ''rank'', jsonb_build_object(''place'', place, ''of'', field, ''points'', my_points),';
  add constant text :=
       E'    -- 186 (MF-031): the running week so far, live\n'
    || E'    ''this_week'', case when s.status = ''active'' then (\n'
    || E'        select jsonb_build_object(''week'', public.season_week(sid),\n'
    || E'                                  ''points'', coalesce(round(sum(lm.day_total))::int, 0), ''lots'', count(lm.*))\n'
    || E'          from public.season_week_bounds(sid, public.season_week(sid)) b\n'
    || E'          left join lateral public.lot_marks(me, b.starts_at, b.ends_at) lm on true) end,\n';
  def text := pg_get_functiondef(f);
begin
  if position(anchor in def) = 0 then raise exception '186: my_season_report no longer has its rank line'; end if;
  execute replace(def, anchor, add || anchor);
  if position('this_week' in pg_get_functiondef(f)) = 0 then raise exception '186: not applied'; end if;
end $$;
commit;
