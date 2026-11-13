-- Rollback 541: remove the new reader; admin_question_bank is unchanged.
drop function if exists public.admin_question_bank_page(text, text, integer, timestamptz, uuid);
notify pgrst, 'reload schema';
