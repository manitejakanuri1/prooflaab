-- 212 (owner 2 Nov 2026, B4): every viewer sees their OWN section's result. Safe for REAL and TEST. Text patches.
--   my_season_status.last_season.champions lists every section that had squads (champion null when that
--   section had none), and last_season.my_bracket is the viewer's own section in that season (null for a
--   college or admin), so a CSE-B student no longer sees CSE-A's champion as theirs.
-- Rollback: migration/212-rollback-champion-per-section.sql
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
  if hits = 0 then raise exception '212: % does not contain the text to patch: %', _fn, left(_old, 80); end if;
end $p$;

select pg_temp.patch('my_season_status',
  $o$jsonb_build_object('bracket', c.bracket, 'champion', q.name,$o$,
  $n$jsonb_build_object('bracket', br.bracket, 'champion', q.name,$n$);
select pg_temp.patch('my_season_status',
  $o$where m.season_id = last.id and m.stage = 'final' and m.cohort = c.bracket$o$,
  $n$where m.season_id = last.id and m.stage = 'final' and m.cohort = c.bracket and c.champion_squad_id is not null$n$);
select pg_temp.patch('my_season_status',
  $o$order by c.bracket), '[]'::jsonb)$o$,
  $n$order by br.bracket), '[]'::jsonb)$n$);
select pg_temp.patch('my_season_status',
  $o$from public.season_champions c join public.squads q on q.id = c.champion_squad_id$o$,
  $n$from (select distinct coalesce(sq.bracket, sq.cohort) as bracket from public.squads sq
                              where sq.season_id = last.id and coalesce(sq.bracket, sq.cohort) is not null) br
                        left join public.season_champions c on c.season_id = last.id and c.bracket = br.bracket
                        left join public.squads q on q.id = c.champion_squad_id$n$);
select pg_temp.patch('my_season_status',
  $o$where c.season_id = last.id)),$o$,
  $n$where true),
        -- 212 (B4): the viewer's own section in that season
        'my_bracket', (select coalesce(q2.bracket, q2.cohort) from public.squad_members m2
                         join public.squads q2 on q2.id = m2.squad_id
                         join public.student_profiles p2 on p2.id = m2.student_id
                        where q2.season_id = last.id and p2.user_id = auth.uid()
                        order by m2.joined_at desc nulls last limit 1)),$n$);

do $$ begin
  if pg_get_functiondef('public.my_season_status()'::regprocedure) !~ 'my_bracket' then
    raise exception '212 self-check: my_season_status has no my_bracket';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
