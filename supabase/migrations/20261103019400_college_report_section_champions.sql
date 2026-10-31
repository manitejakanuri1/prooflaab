-- 194 (MF-062): since migration 184 a season crowns a champion per section (season_champions), but the
-- college report only read the old one-podium-per-season columns, so Insights showed "Still running" for
-- finished seasons and no awards. Each season in tpo_college_report now also carries its year group and its
-- section champions (with runner-up and third). Text swap: the rest of the function is unchanged.
begin;
do $$
declare
  f constant regprocedure := 'public.tpo_college_report()'::regprocedure;
  old_tail constant text := E'''squads'', (select count(*) from public.squads q where q.season_id = s.id))';
  new_tail constant text := E'''squads'', (select count(*) from public.squads q where q.season_id = s.id),\n'
    || E'           ''year_group_label'', coalesce(public.year_group_label(s.year_group), ''No year set''),\n'
    || E'           ''champions'', (select coalesce(jsonb_agg(jsonb_build_object(''bracket'', sc.bracket,\n'
    || E'                              ''champion'', w1.name, ''runner_up'', w2.name, ''third'', w3.name) order by sc.bracket), ''[]''::jsonb)\n'
    || E'                           from public.season_champions sc\n'
    || E'                           left join public.squads w1 on w1.id = sc.champion_squad_id\n'
    || E'                           left join public.squads w2 on w2.id = sc.runner_up_squad_id\n'
    || E'                           left join public.squads w3 on w3.id = sc.third_squad_id\n'
    || E'                          where sc.season_id = s.id))';
  def text := pg_get_functiondef(f);
begin
  if position(old_tail in def) = 0 then raise exception '194: tpo_college_report no longer has its season list'; end if;
  execute replace(def, old_tail, new_tail);
end $$;

do $$
begin
  if pg_get_functiondef('public.tpo_college_report()'::regprocedure) !~ 'season_champions sc' then
    raise exception '194: tpo_college_report was not changed';
  end if;
end $$;
commit;
