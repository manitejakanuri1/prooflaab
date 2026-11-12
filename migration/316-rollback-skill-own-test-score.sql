-- 316 ROLLBACK: my_skills_proved without test_score (the definition before 316).
begin;
drop function if exists public.my_skills_proved();
create function public.my_skills_proved()
 returns table(skill text, status text, claimed_from text, assessed_score integer, proven_lots integer, proven_voice integer,
               topics_cleared bigint, topics_total bigint, needs_improvement boolean, last_evidence_at timestamptz)
 language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select s.skill, s.status, s.claimed_from, s.assessed_score,
         s.proven_lots, s.proven_voice,
         coalesce(ev.cleared, 0), coalesce(ev.total, 0),
         s.status = 'needs_improvement', s.last_evidence_at
    from public.student_skills s
    left join lateral (
      select count(*) filter (where sl.status in ('cleared', 'mastered')) as cleared,
             count(*) as total
        from public.levels l
        left join public.student_levels sl
          on sl.level_id = l.id and sl.student_id = s.student_id
       where lower(l.skill) = lower(s.skill)
    ) ev on true
   where s.student_id = (select auth.uid())
   order by array_position(array['needs_improvement', 'proven', 'assessed', 'claimed'], s.status),
            s.skill;
$function$;
revoke all on function public.my_skills_proved() from public, anon;
grant execute on function public.my_skills_proved() to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
