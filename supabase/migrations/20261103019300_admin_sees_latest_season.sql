-- 193 (MF-035): the admin season list only showed seasons running right now, so a college in the days off
-- between seasons (PRAGATI on TEST, 1 Nov 2026) vanished from it. The list now shows each college's latest
-- season per year group (the running one first), with its status. Text swap: the rest of admin_squads is
-- unchanged; the rollback swaps it back.
begin;
do $$
declare
  f constant regprocedure := 'public.admin_squads(uuid)'::regprocedure;
  old_pick constant text := E'        from public.seasons s join public.colleges c on c.id = s.college_id\n       where s.is_current), ''[]''::jsonb);';
  new_pick constant text := E'        from public.seasons s join public.colleges c on c.id = s.college_id\n       where s.id in (select distinct on (s2.college_id, s2.year_group) s2.id from public.seasons s2\n                       where s2.is_current or s2.year_group is not null\n                       order by s2.college_id, s2.year_group, s2.is_current desc, s2.starts_on desc)), ''[]''::jsonb);';
  old_fields constant text := E'''season'', s.name, ''year_group'', s.year_group,';
  new_fields constant text := E'''season'', s.name, ''year_group'', s.year_group, ''status'', case when s.is_current then ''running'' else s.status end,';
  def text := pg_get_functiondef(f);
begin
  if position(old_pick in def) = 0 or position(old_fields in def) = 0 then
    raise exception '193: admin_squads no longer has its season list';
  end if;
  execute replace(replace(def, old_pick, new_pick), old_fields, new_fields);
end $$;

do $$
begin
  if pg_get_functiondef('public.admin_squads(uuid)'::regprocedure) !~ 'distinct on \(s2.college_id' then
    raise exception '193: admin_squads was not changed';
  end if;
end $$;
commit;
