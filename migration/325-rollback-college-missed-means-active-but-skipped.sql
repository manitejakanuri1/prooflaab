-- Rollback of 325: tpo_attention back to the Monday..yesterday "missed" count (as on TEST before 325), Home label back.
begin;
CREATE OR REPLACE FUNCTION public.tpo_attention()
 RETURNS TABLE(student_id uuid, full_name text, roll_number text, branch text, days_quiet integer, reason_codes text[], reasons text[], severity text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'Asia/Kolkata'
AS $function$
  with mine as (select public.my_college_id() as cid),
  base as (
    select p.id, p.full_name, p.roll_number, p.branch,
           case when ls.last_try is null then 999
                else (current_date - (ls.last_try at time zone 'Asia/Kolkata')::date) end as quiet,
           p.onboarding_status,
           (select count(*) from public.tasks t
             where t.student_id = p.id and t.source = 'daily_lot'
               and t.lot_date >= date_trunc('week', now() at time zone 'Asia/Kolkata')::date
               and t.lot_date < (now() at time zone 'Asia/Kolkata')::date
               and not exists (select 1 from public.task_submissions s where s.task_id = t.id and s.student_id = p.id))
             as missed_this_week
      from public.student_profiles p
      cross join mine
      left join lateral (select max(s.created_at) as last_try from public.task_submissions s where s.student_id = p.id) ls on true
     where p.college_id = mine.cid and mine.cid is not null
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
                then b.missed_this_week || case when b.missed_this_week = 1 then ' Lot' else ' Lots' end || ' not tried this week' end
         ], null),
         case when b.quiet >= 14 or b.missed_this_week >= 3 then 'high'
              when b.quiet >= 7  or b.missed_this_week >= 1
                   or b.onboarding_status <> 'completed'     then 'medium'
              else 'low' end
    from base b
   where b.quiet >= 7 or b.onboarding_status <> 'completed' or b.missed_this_week >= 1
   order by b.quiet desc;
$function$;
do $$
declare d text := pg_get_functiondef('public.tpo_home'::regproc);
begin
  if position('tried a Lot this week but missed another' in d) > 0 then
    execute replace(d, 'then ''tried a Lot this week but missed another''', 'then ''missed this week''''s Lot''');
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
