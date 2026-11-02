-- Rollback of 212: every patch undone (same text, swapped).
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
  if hits = 0 then raise exception '212 rollback: % does not contain the text to patch: %', _fn, left(_old, 80); end if;
end $p$;

select pg_temp.patch('my_season_status',
  $x$where true),
        -- 212 (B4): the viewer's own section in that season
        'my_bracket', (select coalesce(q2.bracket, q2.cohort) from public.squad_members m2
                         join public.squads q2 on q2.id = m2.squad_id
                         join public.student_profiles p2 on p2.id = m2.student_id
                        where q2.season_id = last.id and p2.user_id = auth.uid()
                        order by m2.joined_at desc nulls last limit 1)),$x$,
  $y$where c.season_id = last.id)),$y$);
select pg_temp.patch('my_season_status',
  $x$from (select distinct coalesce(sq.bracket, sq.cohort) as bracket from public.squads sq
                              where sq.season_id = last.id and coalesce(sq.bracket, sq.cohort) is not null) br
                        left join public.season_champions c on c.season_id = last.id and c.bracket = br.bracket
                        left join public.squads q on q.id = c.champion_squad_id$x$,
  $y$from public.season_champions c join public.squads q on q.id = c.champion_squad_id$y$);
select pg_temp.patch('my_season_status',
  $x$order by br.bracket), '[]'::jsonb)$x$,
  $y$order by c.bracket), '[]'::jsonb)$y$);
select pg_temp.patch('my_season_status',
  $x$where m.season_id = last.id and m.stage = 'final' and m.cohort = c.bracket and c.champion_squad_id is not null$x$,
  $y$where m.season_id = last.id and m.stage = 'final' and m.cohort = c.bracket$y$);
select pg_temp.patch('my_season_status',
  $x$jsonb_build_object('bracket', br.bracket, 'champion', q.name,$x$,
  $y$jsonb_build_object('bracket', c.bracket, 'champion', q.name,$y$);
notify pgrst, 'reload schema';
commit;
