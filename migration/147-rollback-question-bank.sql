-- Rollback of 147: removes the question bank. Nothing else depends on it (Lots are not picked from it).
-- Every stored question and review decision is deleted.
begin;
drop function if exists public.admin_set_question_status(uuid, text);
drop function if exists public.admin_question_bank(text, integer, timestamptz);
drop function if exists public.question_bank_add(uuid, jsonb, jsonb);
drop function if exists public.question_bank_pending(integer);
drop trigger if exists question_bank_tag on public.question_bank;
drop function if exists public.question_bank_tag();
drop table if exists public.question_bank_attempts;
drop table if exists public.question_bank;
commit;
notify pgrst, 'reload schema';
