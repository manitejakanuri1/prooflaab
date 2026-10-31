-- Rollback of 193: the admin season list shows running seasons only again (text swap back).
begin;
do $$
declare
  f constant regprocedure := 'public.admin_squads(uuid)'::regprocedure;
  def text := pg_get_functiondef(f);
begin
  def := replace(def, E'        from public.seasons s join public.colleges c on c.id = s.college_id\n       where s.id in (select distinct on (s2.college_id, s2.year_group) s2.id from public.seasons s2\n                       where s2.is_current or s2.year_group is not null\n                       order by s2.college_id, s2.year_group, s2.is_current desc, s2.starts_on desc)), ''[]''::jsonb);',
                       E'        from public.seasons s join public.colleges c on c.id = s.college_id\n       where s.is_current), ''[]''::jsonb);');
  def := replace(def, E'''season'', s.name, ''year_group'', s.year_group, ''status'', case when s.is_current then ''running'' else s.status end,',
                      E'''season'', s.name, ''year_group'', s.year_group,');
  execute def;
end $$;
commit;
