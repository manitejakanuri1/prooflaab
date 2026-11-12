-- Rollback of 490: untag the questions it tagged and remove the skill.
begin;
update public.question_bank
   set skill = null, skills = '{}', provenance = provenance - 'skill_by'
 where provenance ->> 'skill_by' = 'career_tag_490';
delete from public.skill_vocab where skill = 'Career Readiness';
notify pgrst, 'reload schema';
commit;
