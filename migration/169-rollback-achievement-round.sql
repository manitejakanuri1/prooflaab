-- Rollback of 169: the earlier my_squad_achievements body.
begin;

CREATE OR REPLACE FUNCTION public.my_squad_achievements()
 RETURNS TABLE(kind text, title text, detail text, achieved_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare sq uuid;
begin
  select m.squad_id into sq from public.squad_members m
   where m.student_id = (select auth.uid()) and m.left_at is null limit 1;
  return query
    select 'win'::text,
           'Match won'::text,
           ('Beat ' || coalesce(o.name, 'the other squad') || ' ' ||
             greatest(coalesce(mt.home_points, 0), coalesce(mt.away_points, 0)) || '-' ||
             least(coalesce(mt.home_points, 0), coalesce(mt.away_points, 0)))::text,
           mt.scheduled_at
      from public.squad_matches mt
      left join public.squads o
        on o.id = case when mt.home_squad = sq then mt.away_squad else mt.home_squad end
     where mt.status = 'played'
       and (mt.home_squad = sq or mt.away_squad = sq)
       and case when mt.home_squad = sq
                then coalesce(mt.home_points, 0) > coalesce(mt.away_points, 0)
                else coalesce(mt.away_points, 0) > coalesce(mt.home_points, 0) end
    union all
    select 'week'::text,
           'Top of the table'::text,
           ('Week ' || w.week || ' - ' || w.points || ' points from ' ||
             w.active_members || ' of ' || w.total_members || ' members')::text,
           w.computed_at
      from public.squad_weekly_scores w
     where w.squad_id = sq and w.rank = 1
    union all
    select * from public.squad_championship_achievements(sq)
    union all
    select 'milestone'::text,
           m.label::text,
           (s.name || ' has ' || s.points || ' points')::text,
           s.updated_at
      from public.squads s
      cross join (values (100, 'First hundred'), (500, 'Five hundred points'),
                         (1000, 'A thousand points')) as m(threshold, label)
     where s.id = sq and s.points >= m.threshold
    union all
    select 'badge'::text, b.name::text, b.description::text, sb.awarded_at
      from public.student_badges sb
      join public.badges b on b.slug = sb.badge_slug
     where sb.student_id = (select auth.uid())
    order by 4 desc nulls last;
end $function$;

commit;
notify pgrst, 'reload schema';
