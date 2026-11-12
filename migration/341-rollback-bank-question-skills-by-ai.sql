-- Rollback of 341: the AI-tagged questions go back to no skill, and their Lot candidates are re-synced.
begin;
update public.question_bank q set skill = null, skills = '{}'
  from public.bank_skill_retag_341 b where b.question_id = q.id and b.skill is not null and q.skill = b.skill;
select public.sync_lot_candidate(t.id)
  from public.lot_templates t
  join public.source_content s on s.id = t.source_content_id
  join public.bank_skill_retag_341 b on b.question_id = s.bank_question_id
 where b.skill is not null;
drop table public.bank_skill_retag_341;
commit;
