-- 189 (MF-039, MF-025): student_skills had 0 rows on TEST, so skill pages said "Nothing measured yet" and
-- companies saw "Skills proven 0". When the onboarding test is graded (resume_scorecards.skill_gap), its result
-- is now saved per skill:
--   verified by the test           -> 'proven'  (owner rule: a skill shows only when it is proven)
--   needs improvement              -> 'needs_improvement'
--   on the resume, not yet tested  -> 'claimed' (never shown as a skill)
-- A skill already proven stays proven. Existing scorecards are back-filled.
-- Rollback: migration/189-rollback-skills-from-onboarding-test.sql
begin;
create or replace function public.skills_from_scorecard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare g jsonb := new.skill_gap; claims text[];
begin
  if g is null or jsonb_typeof(g) <> 'object' then return new; end if;
  select coalesce(c.skills, '{}') into claims from public.resume_claims c where c.id = new.resume_claims_id;
  insert into public.student_skills (student_id, skill, status, claimed_from, assessed_score, last_evidence_at)
  select new.student_id, x.skill, x.status, 'onboarding_test', new.skill_proof_score, now()
    from (
      select distinct on (lower(trim(s.skill))) trim(s.skill) as skill, s.status
        from (
          select v as skill, 'proven' as status, 1 as pri
            from jsonb_array_elements_text(case when jsonb_typeof(g->'verified') = 'array' then g->'verified' else '[]' end) v
          union all
          select v, 'needs_improvement', 2
            from jsonb_array_elements_text(case when jsonb_typeof(g->'needs_improvement') = 'array' then g->'needs_improvement' else '[]' end) v
          union all
          select v, 'claimed', 3 from unnest(claims) v
        ) s
       where nullif(trim(s.skill), '') is not null
       order by lower(trim(s.skill)), s.pri) x
  on conflict (student_id, skill) do update set
    status = case when public.student_skills.status = 'proven' then 'proven'
                  when excluded.status = 'claimed' then public.student_skills.status
                  else excluded.status end,
    assessed_score = excluded.assessed_score,
    last_evidence_at = now();
  return new;
end $fn$;
revoke all on function public.skills_from_scorecard() from public, anon, authenticated;

drop trigger if exists resume_scorecards_save_skills on public.resume_scorecards;
create trigger resume_scorecards_save_skills
  after insert or update of skill_gap on public.resume_scorecards
  for each row execute function public.skills_from_scorecard();

-- back-fill: replay every graded scorecard, oldest first
update public.resume_scorecards set skill_gap = skill_gap
 where skill_gap is not null;

do $$
begin
  if exists (select 1 from public.resume_scorecards c where jsonb_typeof(c.skill_gap->'verified') = 'array'
              and jsonb_array_length(c.skill_gap->'verified') > 0)
     and not exists (select 1 from public.student_skills where claimed_from = 'onboarding_test' and status = 'proven') then
    raise exception '189: verified skills were not saved';
  end if;
end $$;
commit;
