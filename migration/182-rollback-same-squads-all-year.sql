-- Rollback of 182: a new season makes new squads again. Squads already carried over stay as they are.
begin;
CREATE OR REPLACE FUNCTION public.ensure_season(_college_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare sid uuid; n integer; nm text;
begin
  if _college_id is null then return null; end if;
  select id into sid from public.seasons
   where college_id = _college_id and is_current
   order by starts_on desc limit 1;
  if sid is not null then return sid; end if;
  select count(*) into n from public.seasons where college_id = _college_id;
  nm := 'Season ' || (n + 1);
  insert into public.seasons (name, college_id, starts_on, ends_on,
                              is_current, planned_weeks, status)
  values (nm, _college_id, current_date, current_date + (12 * 7), true, 12, 'active')
  returning id into sid;
  perform public.write_audit('SEASON_OPENED', 'seasons', sid, null,
    jsonb_build_object('name', nm, 'planned_weeks', 12), _college_id);
  return sid;
end $function$;
drop function if exists public.carry_over_squads(uuid);
drop function if exists public.school_year(date);
notify pgrst, 'reload schema';
commit;
