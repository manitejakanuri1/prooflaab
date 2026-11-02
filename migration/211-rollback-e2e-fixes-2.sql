-- Rollback of 211: every patch undone (same text, swapped).
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
  if hits = 0 then raise exception '211 rollback: % does not contain the text to patch: %', _fn, left(_old, 80); end if;
end $p$;

select pg_temp.patch('admin_squads',
  'order by s2.college_id, s2.year_group, s2.is_current desc, s2.starts_on desc, s2.created_at desc)',
  'order by s2.college_id, s2.year_group, s2.is_current desc, s2.starts_on desc)');
select pg_temp.patch('tpo_college_report',
  $x$'completed_at', s.completed_at, 'created_at', s.created_at,$x$,
  $y$'completed_at', s.completed_at,$y$);
select pg_temp.patch('tpo_college_report',
  'order by s.starts_on desc, s.created_at desc), ''[]''::jsonb)',
  'order by s.starts_on desc), ''[]''::jsonb)');
select pg_temp.patch('tpo_college_report',
  $x$'champions', (select coalesce(jsonb_agg(jsonb_build_object('bracket', br.bracket,
                              'champion', w1.name, 'runner_up', w2.name, 'third', w3.name,
                              'decided_by', coalesce(sc.decided_by,
                                (select m.decided_by from public.squad_matches m
                                  where m.season_id = s.id and m.stage = 'final' and m.cohort = br.bracket
                                    and public.match_winner(m.id) = sc.champion_squad_id
                                  order by m.scheduled_at desc limit 1))) order by br.bracket), '[]'::jsonb)
                           from (select distinct coalesce(q.bracket, q.cohort) as bracket from public.squads q
                                  where q.season_id = s.id and coalesce(q.bracket, q.cohort) is not null) br
                           left join public.season_champions sc on sc.season_id = s.id and sc.bracket = br.bracket
                           left join public.squads w1 on w1.id = sc.champion_squad_id
                           left join public.squads w2 on w2.id = sc.runner_up_squad_id
                           left join public.squads w3 on w3.id = sc.third_squad_id))$x$,
  $y$'champions', (select coalesce(jsonb_agg(jsonb_build_object('bracket', sc.bracket,
                              'champion', w1.name, 'runner_up', w2.name, 'third', w3.name) order by sc.bracket), '[]'::jsonb)
                           from public.season_champions sc
                           left join public.squads w1 on w1.id = sc.champion_squad_id
                           left join public.squads w2 on w2.id = sc.runner_up_squad_id
                           left join public.squads w3 on w3.id = sc.third_squad_id
                          where sc.season_id = s.id))$y$);
notify pgrst, 'reload schema';
commit;
