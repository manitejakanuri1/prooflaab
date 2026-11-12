-- 325 (owner E2E 12 Nov 2026, R5): college Home said "50 students missed this week's Lot" next to "12 tried a Lot this
--   week" out of 52 - the two used different weeks (Monday..yesterday vs the last 7 India days) and overlapped.
--   Now one window, the one migration 297 set for "active": the last 7 India days (today and the 6 before).
--   - inactive    = no Lot tried in those 7 days                          (= students - "tried a Lot this week")
--   - missed_lots = tried a Lot in those 7 days, but left an earlier Daily Lot of those days untried
--   So the two never count the same student: inactive + active = students, missed_lots is part of active.
--   Home's line now reads "tried a Lot this week but missed another".
-- Rollback: migration/325-rollback-college-missed-means-active-but-skipped.sql
begin;
CREATE OR REPLACE FUNCTION public.tpo_attention()
 RETURNS TABLE(student_id uuid, full_name text, roll_number text, branch text, days_quiet integer, reason_codes text[], reasons text[], severity text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
  with mine as (select public.my_college_id() as cid),
  base0 as (
    select p.id, p.full_name, p.roll_number, p.branch,
           case when ls.last_try is null then 999
                else (current_date - (ls.last_try at time zone 'Asia/Kolkata')::date) end as quiet,
           p.onboarding_status
      from public.student_profiles p
      cross join mine
      left join lateral (select max(s.created_at) as last_try from public.task_submissions s where s.student_id = p.id) ls on true
     where p.college_id = mine.cid and mine.cid is not null
  ),
  base as (
    select b0.*,
           -- 325: only for a student who tried a Lot in the last 7 India days (else they are 'inactive'),
           -- counting that student's Daily Lots of the same 7 days, before today, that were never tried.
           case when b0.quiet <= 6 then
             (select count(*) from public.tasks t
               where t.student_id = b0.id and t.source = 'daily_lot'
                 and t.lot_date >= current_date - 6 and t.lot_date < current_date
                 and not exists (select 1 from public.task_submissions s where s.task_id = t.id and s.student_id = b0.id))
           else 0 end as missed_this_week
      from base0 b0
  )
  select b.id, b.full_name, b.roll_number, b.branch, b.quiet,
         array_remove(array[
           case when b.quiet >= 7                       then 'inactive' end,
           case when b.onboarding_status <> 'completed' then 'onboarding' end,
           case when b.missed_this_week >= 1            then 'missed_lots' end
         ], null),
         array_remove(array[
           case when b.quiet >= 999 then 'Has not tried a Lot yet'
                when b.quiet >= 7 then 'No Lot tried for ' || b.quiet || ' days' end,
           case when b.onboarding_status <> 'completed'
                then 'Onboarding not finished (' || b.onboarding_status || ')' end,
           case when b.missed_this_week >= 1
                then b.missed_this_week || case when b.missed_this_week = 1 then ' Lot' else ' Lots' end || ' not tried in the last 7 days' end
         ], null),
         case when b.quiet >= 14 or b.missed_this_week >= 3 then 'high'
              when b.quiet >= 7  or b.missed_this_week >= 1
                   or b.onboarding_status <> 'completed'     then 'medium'
              else 'low' end
    from base b
   where b.quiet >= 7 or b.onboarding_status <> 'completed' or b.missed_this_week >= 1
   order by b.quiet desc;
$function$;

-- Home's line for 'missed_lots' (the rest of tpo_home is unchanged).
do $$
declare d text := pg_get_functiondef('public.tpo_home'::regproc);
begin
  if position('then ''missed this week''''s Lot''' in d) > 0 then
    execute replace(d, 'then ''missed this week''''s Lot''', 'then ''tried a Lot this week but missed another''');
  end if;
end $$;

do $$
begin
  if position('current_date - 6 and t.lot_date < current_date' in pg_get_functiondef('public.tpo_attention'::regproc)) = 0 then
    raise exception '325 self-check: tpo_attention missed window not the last 7 India days';
  end if;
  if position('tried a Lot this week but missed another' in pg_get_functiondef('public.tpo_home'::regproc)) = 0 then
    raise exception '325 self-check: tpo_home wording not changed';
  end if;
  if not exists (select 1 from pg_proc where proname = 'tpo_attention' and proconfig @> array['TimeZone=Asia/Kolkata']) then
    raise exception '325 self-check: tpo_attention lost India time';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
