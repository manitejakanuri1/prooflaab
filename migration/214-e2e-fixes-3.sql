-- 214 (owner 2 Nov 2026, Grok's round-3 end-to-end run). Safe for REAL and TEST.
--   F2  my_squad_members: between seasons (everyone's membership closed by close_season) the Squad page
--       showed "0 of 0 members" and no names. It now lists the squad the student was last in, with the
--       members who were still in it when the season closed (left within a minute of completed_at).
--   F13 my_season_report: with no running season it took the student's weekly score row with the highest
--       week number - every season has a week 12, so it could pick Season 1. Now the newest scored row.
--   F6  tpo_home: "Squads" counted every squad the college ever had (24); now the squads of each year
--       group's latest season, the same pick as the admin list (migration 193).
--   F10 suggest_tracks: the reason said "1 of the 48 steps" when 48 of 48 steps matched (it counted
--       distinct skills, not steps); it now says how many steps match, like the percentage.
-- Rollback: migration/214-rollback-e2e-fixes-3.sql
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
  if hits = 0 then raise exception '214: % does not contain the text to patch: %', _fn, left(_old, 80); end if;
end $p$;

select pg_temp.patch('my_squad_members',
  $o$   where m.left_at is null
     and m.squad_id = (select mine.squad_id from public.squad_members mine
                        where mine.student_id = (select auth.uid()) and mine.left_at is null
                        order by mine.joined_at desc limit 1)$o$,
  $n$    join public.squads q on q.id = m.squad_id
    left join public.seasons s on s.id = q.season_id
   where (m.left_at is null or (s.completed_at is not null and m.left_at >= s.completed_at - interval '1 minute'))
     and m.squad_id = (select mine.squad_id from public.squad_members mine
                        where mine.student_id = (select auth.uid())
                        order by (mine.left_at is null) desc, mine.left_at desc nulls last, mine.joined_at desc limit 1)$n$);

select pg_temp.patch('my_season_report',
  'where w.student_id = me order by w.week desc limit 1),',
  'where w.student_id = me order by w.computed_at desc nulls last, w.week desc limit 1),');

select pg_temp.patch('tpo_home',
  $o$'squads', (select count(*) from public.squads where college_id = cid),$o$,
  $n$'squads', (select count(*) from public.squads q2 where q2.college_id = cid
                  and q2.season_id in (select distinct on (s2.year_group) s2.id from public.seasons s2
                                        where s2.college_id = cid and (s2.is_current or s2.year_group is not null)
                                        order by s2.year_group, s2.is_current desc, s2.created_at desc)),$n$);

select pg_temp.patch('suggest_tracks',
  $o$' — 1 of the ' || s.total_steps$o$,
  $n$' — ' || s.matched_steps || ' of the ' || s.total_steps$n$);
select pg_temp.patch('suggest_tracks',
  $o$' — 2 of the ' || s.total_steps$o$,
  $n$' — ' || s.matched_steps || ' of the ' || s.total_steps$n$);

do $$ begin
  if pg_get_functiondef('public.my_squad_members()'::regprocedure) !~ 'completed_at' then
    raise exception '214 self-check: my_squad_members not changed';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
