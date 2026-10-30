-- 187 (MF-031, part 2): the season report picked the season of the student's last scored week, so in a new
-- season it kept showing the old one. It now picks the running season of the student's squad first.
-- Rollback: migration/187-rollback-season-report-current-season.sql
begin;
do $$
declare
  f constant regprocedure := 'public.my_season_report(uuid)'::regprocedure;
  anchor constant text := E'           (select w.season_id from public.student_weekly_scores w\n             where w.student_id = me order by w.week desc limit 1),';
  add constant text :=
       E'           -- 187 (MF-031): the running season of my squad first\n'
    || E'           (select q.season_id from public.squad_members m join public.squads q on q.id = m.squad_id\n'
    || E'             join public.seasons x on x.id = q.season_id\n'
    || E'             where m.student_id = me and m.left_at is null and x.is_current limit 1),\n';
  def text := pg_get_functiondef(f);
begin
  if position(anchor in def) = 0 then raise exception '187: my_season_report no longer has its season pick'; end if;
  execute replace(def, anchor, add || anchor);
  if position('187 (MF-031)' in pg_get_functiondef(f)) = 0 then raise exception '187: not applied'; end if;
end $$;
commit;
