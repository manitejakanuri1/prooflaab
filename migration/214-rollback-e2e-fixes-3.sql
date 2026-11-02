-- Rollback of 214: every patch undone (same text, swapped).
begin;
create or replace function pg_temp.patch(_fn text, _old text, _new text) returns void language plpgsql as $p$
declare f record; def text; hits int := 0;
begin
  for f in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = _fn loop
    def := pg_get_functiondef(f.oid);
    if position(_old in def) > 0 then
      execute replace(def, _old, _new);
      hits := hits + 1;
    end if;
  end loop;
  if hits = 0 then raise exception '214 rollback: % does not contain the text to patch: %', _fn, left(_old, 80); end if;
end $p$;

select pg_temp.patch('tpo_home',
  $x$'squads', (select count(*) from public.squads q2 where q2.college_id = cid
                  and q2.season_id in (select distinct on (s2.year_group) s2.id from public.seasons s2
                                        where s2.college_id = cid and (s2.is_current or s2.year_group is not null)
                                        order by s2.year_group, s2.is_current desc, s2.created_at desc)),$x$,
  $y$'squads', (select count(*) from public.squads where college_id = cid),$y$);
select pg_temp.patch('my_season_report',
  'where w.student_id = me order by w.computed_at desc nulls last, w.week desc limit 1),',
  'where w.student_id = me order by w.week desc limit 1),');
select pg_temp.patch('my_squad_members',
  $x$    join public.squads q on q.id = m.squad_id
    left join public.seasons s on s.id = q.season_id
   where (m.left_at is null or (s.completed_at is not null and m.left_at >= s.completed_at - interval '1 minute'))
     and m.squad_id = (select mine.squad_id from public.squad_members mine
                        where mine.student_id = (select auth.uid())
                        order by (mine.left_at is null) desc, mine.left_at desc nulls last, mine.joined_at desc limit 1)$x$,
  $y$   where m.left_at is null
     and m.squad_id = (select mine.squad_id from public.squad_members mine
                        where mine.student_id = (select auth.uid()) and mine.left_at is null
                        order by mine.joined_at desc limit 1)$y$);
-- suggest_tracks: the first matched_steps text is the 1-skill branch, the second the 2-skill branch.
do $r$ declare f oid := 'public.suggest_tracks'::regproc; d text := pg_get_functiondef('public.suggest_tracks'::regproc);
  k text := $k$' — ' || s.matched_steps || ' of the ' || s.total_steps$k$; i int;
begin
  i := position(k in d); d := overlay(d placing $a$' — 1 of the ' || s.total_steps$a$ from i for length(k));
  i := position(k in d); d := overlay(d placing $b$' — 2 of the ' || s.total_steps$b$ from i for length(k));
  execute d;
end $r$;
notify pgrst, 'reload schema';
commit;
