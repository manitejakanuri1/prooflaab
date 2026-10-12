-- S39: run AFTER 108 and 109 on production. Changes nothing; fails loudly if either is not in place.
do $$
declare d text := pg_get_functiondef('public.form_squads(uuid,uuid)'::regprocedure);
begin
  if position('and not s.is_locked -- 108' in d) = 0 or position('< least(11, s.max_members)' in d) = 0 then
    raise exception 'S39 VERIFY FAILED: 108 is not applied to form_squads';
  end if;
  if position('colleges_failed' in pg_get_functiondef('public.form_all_colleges()'::regprocedure)) = 0 then
    raise exception 'S39 VERIFY FAILED: 108 is not applied to form_all_colleges';
  end if;
  if (select count(distinct branch) from public.squad_name_themes where college_id is null) < 9 then
    raise exception 'S39 VERIFY FAILED: 109 default themes missing';
  end if;
end $$;
