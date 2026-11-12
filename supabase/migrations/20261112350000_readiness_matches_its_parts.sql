-- F4 (12 Nov 2026): Interview Readiness shown (interview_readiness_score) must equal the formula the screen explains
-- (resume-assessment-submit: quality 20 + ATS 20 + skill 30 + project 15 + reasoning 15, a missing part left out,
-- Math.round). Every scorecard the function wrote already matches; 45 rows written by the E2E seed scripts
-- (31 Oct, 3 Nov) do not (Vikram: stored 52, parts give 61.4 -> 61). The formula is NOT changed: those rows get the
-- value the function itself would have written. Rollback: 350-rollback-readiness-matches-its-parts.sql.
with f as (
  select s.id,
    round((coalesce(resume_quality_score * 20, 0) + coalesce(ats_match_score * 20, 0) + coalesce(skill_proof_score * 30, 0)
         + coalesce(project_proof_score * 15, 0) + coalesce(reasoning_score * 15, 0))::numeric
      / nullif((case when resume_quality_score is not null then 20 else 0 end) + (case when ats_match_score is not null then 20 else 0 end)
         + (case when skill_proof_score is not null then 30 else 0 end) + (case when project_proof_score is not null then 15 else 0 end)
         + (case when reasoning_score is not null then 15 else 0 end), 0))::int as calc
  from resume_scorecards s)
update resume_scorecards s set interview_readiness_score = f.calc
from f where f.id = s.id and s.skill_proof_score is not null and s.interview_readiness_score is distinct from f.calc;

do $$
declare bad int;
begin
  select count(*) into bad from resume_scorecards s
  where s.skill_proof_score is not null and s.interview_readiness_score is distinct from
    round((coalesce(resume_quality_score * 20, 0) + coalesce(ats_match_score * 20, 0) + coalesce(skill_proof_score * 30, 0)
         + coalesce(project_proof_score * 15, 0) + coalesce(reasoning_score * 15, 0))::numeric
      / ((case when resume_quality_score is not null then 20 else 0 end) + (case when ats_match_score is not null then 20 else 0 end)
         + 30 + (case when project_proof_score is not null then 15 else 0 end) + (case when reasoning_score is not null then 15 else 0 end)))::int;
  if bad > 0 then raise exception '350: % scorecards still differ from their parts', bad; end if;
  raise notice '350 ok: every scorecard readiness equals its parts';
end $$;
