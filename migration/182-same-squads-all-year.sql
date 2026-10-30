-- 182 (owner, 30 Oct 2026): the same squads all school year.
--   Before: close_season ended every squad and the next season dealt everyone into brand-new squads.
--   Now, when a new season opens (ensure_season), the squads of the college's last finished season come back in
--   the new season with the same name, section and members, points starting from 0. Past seasons keep their own
--   squad rows, so history, matches and awards are untouched.
--   Not carried: a student who left the college, is blocked, moved section, or is already in a squad. They wait in
--   Reserve and are seated in week 1 (free seats, or a new squad once 11 of a section are waiting; migration 179).
--   A new school year starts fresh: nothing carries when the last season began in an earlier school year.
--   School year = 1 June to 31 May (public.school_year).
-- Rollback: migration/182-rollback-same-squads-all-year.sql
begin;

-- The school year a date belongs to: 1 June 2026 - 31 May 2027 is 2026.
create or replace function public.school_year(_d date)
returns integer language sql immutable set search_path = public, pg_temp as $fn$
  select extract(year from _d - interval '5 months')::int;
$fn$;

create or replace function public.carry_over_squads(_season_id uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  s record; prev record; q record; new_id uuid; carried integer := 0;
begin
  select * into s from public.seasons where id = _season_id;
  if s.id is null then return 0; end if;
  -- the college's last finished season
  select * into prev from public.seasons
   where college_id = s.college_id and id <> s.id and status = 'complete' and completed_at is not null
   order by completed_at desc limit 1;
  if prev.id is null or public.school_year(prev.starts_on) <> public.school_year(s.starts_on) then return 0; end if;
  -- already carried (or squads already made) for this season
  if exists (select 1 from public.squads where season_id = s.id and archived_at is null) then return 0; end if;

  perform set_config('app.system_write', 'on', true);
  for q in select * from public.squads where season_id = prev.id order by name loop
    insert into public.squads (name, college_id, season_id, cohort, max_members)
    values (q.name, q.college_id, s.id, q.cohort, q.max_members)
    returning id into new_id;
    -- the members the season let go when it closed (close_season sets left_at = completed_at)
    insert into public.squad_members (squad_id, student_id, role, membership_type, joined_at)
    select new_id, m.student_id, m.role, m.membership_type, now()
      from public.squad_members m
      join public.student_profiles p on p.id = m.student_id
     where m.squad_id = q.id
       and m.left_at = prev.completed_at
       and p.college_id = s.college_id
       and p.onboarding_status <> 'blocked'
       and p.cohort is not distinct from q.cohort
       and not exists (select 1 from public.squad_members x where x.student_id = m.student_id and x.left_at is null);
    carried := carried + 1;
  end loop;
  -- a squad nobody came back to is not kept
  delete from public.squads n
   where n.season_id = s.id
     and not exists (select 1 from public.squad_members m where m.squad_id = n.id and m.left_at is null);
  perform set_config('app.system_write', 'off', true);

  perform public.write_audit('SQUADS_CARRIED_OVER', 'squads', s.id, null,
    jsonb_build_object('from_season', prev.id,
                       'squads', (select count(*) from public.squads where season_id = s.id)), s.college_id);
  return (select count(*)::int from public.squads where season_id = s.id);
end $fn$;
revoke all on function public.carry_over_squads(uuid) from public, anon, authenticated;
grant execute on function public.carry_over_squads(uuid) to service_role;

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
  -- 182 (owner): the same squads carry on all school year; a new school year starts fresh.
  perform public.carry_over_squads(sid);
  return sid;
end $function$;

do $$
begin
  if pg_get_functiondef('public.ensure_season(uuid)'::regprocedure) !~ 'carry_over_squads' then
    raise exception '182: a new season does not carry the squads over';
  end if;
  if public.school_year('2026-06-01') <> 2026 or public.school_year('2027-05-31') <> 2026 or public.school_year('2026-05-31') <> 2025 then
    raise exception '182: school_year is wrong';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
