-- Rollback of 331: the questions 331 tagged go back to no skill, and their Lot candidates are re-synced.
begin;
update public.question_bank q set skill = null, skills = '{}' from public.bank_skill_retag_331 b where q.id = b.question_id;
select public.sync_lot_candidate(t.id)
  from public.lot_templates t
  join public.source_content s on s.id = t.source_content_id
  join public.bank_skill_retag_331 b on b.question_id = s.bank_question_id;
drop table public.bank_skill_retag_331;
commit;
