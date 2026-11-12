-- 316 (owner E2E report 12 Nov 2026, item S10): Skills tab showed the same 5.9/10 starting-test score under every skill.
-- student_skills.assessed_score is the overall test average copied onto each skill. The graded test does keep
-- each question's topic ("Pandas - GroupBy") and score (answer_scores.final_score), so my_skills_proved now also
-- returns test_score: the average of this skill's own questions in the latest graded test (null when the test had
-- no question on it, or kept no per-question scores). Display only: nothing is re-scored, nothing is written.
-- Return type changes, so the function is dropped and made again with the same grants.
-- Rollback: migration/316-rollback-skill-own-test-score.sql
begin;
drop function if exists public.my_skills_proved();
create function public.my_skills_proved()
 returns table(skill text, status text, claimed_from text, assessed_score integer, proven_lots integer, proven_voice integer,
               topics_cleared bigint, topics_total bigint, needs_improvement boolean, last_evidence_at timestamptz,
               test_score integer)
 language sql stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select s.skill, s.status, s.claimed_from, s.assessed_score,
         s.proven_lots, s.proven_voice,
         coalesce(ev.cleared, 0), coalesce(ev.total, 0),
         s.status = 'needs_improvement', s.last_evidence_at,
         ts.score
    from public.student_skills s
    left join lateral (
      select count(*) filter (where sl.status in ('cleared', 'mastered')) as cleared,
             count(*) as total
        from public.levels l
        left join public.student_levels sl
          on sl.level_id = l.id and sl.student_id = s.student_id
       where lower(l.skill) = lower(s.skill)
    ) ev on true
    left join lateral (
      -- Same skill match as normSkill in TestMistakes.tsx: case, spaces, dots, dashes ignored.
      select round(avg((sc->>'final_score')::numeric))::int as score
        from (select ra.questions, ra.answer_scores from public.resume_assessments ra
               where ra.student_id = s.student_id and ra.status = 'graded'
                 and jsonb_typeof(ra.answer_scores) = 'array' and jsonb_typeof(ra.questions) = 'array'
               order by ra.created_at desc limit 1) r
        cross join lateral jsonb_array_elements(r.answer_scores) sc
        join lateral jsonb_array_elements(r.questions) q on q->>'id' = sc->>'question_id'
       where sc->>'final_score' ~ '^[0-9.]+$'
         and regexp_replace(lower(split_part(q->>'topic', ' - ', 1)), '[\s._-]', '', 'g')
             = regexp_replace(lower(s.skill), '[\s._-]', '', 'g')
    ) ts on true
   where s.student_id = (select auth.uid())
   order by array_position(array['needs_improvement', 'proven', 'assessed', 'claimed'], s.status),
            s.skill;
$function$;
revoke all on function public.my_skills_proved() from public, anon;
grant execute on function public.my_skills_proved() to authenticated, service_role;

do $$
declare n int;
begin
  -- The per-skill match must find something on TEST data that has per-question scores.
  select count(*) into n
    from public.resume_assessments ra
    cross join lateral jsonb_array_elements(ra.answer_scores) sc
    join lateral jsonb_array_elements(ra.questions) q on q->>'id' = sc->>'question_id'
    join public.student_skills s on s.student_id = ra.student_id
     and regexp_replace(lower(split_part(q->>'topic', ' - ', 1)), '[\s._-]', '', 'g') = regexp_replace(lower(s.skill), '[\s._-]', '', 'g')
   where ra.status = 'graded' and jsonb_typeof(ra.answer_scores) = 'array';
  raise notice '316: per-skill question matches on this database: %', n;
  if not has_function_privilege('authenticated', 'public.my_skills_proved()', 'execute') then
    raise exception '316 self-check: grant';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
