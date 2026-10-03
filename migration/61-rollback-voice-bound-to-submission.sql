-- Rollback of 61. Restores the pre-61 behaviour: recordings linked to a task only, student delete policy back,
-- company functions as in migration 54. The new columns are dropped (attempt numbers, authority flags,
-- withdrawal marks and saved evaluations are lost; transcripts already erased by a withdrawal stay erased).
begin;
drop trigger if exists voice_authority_fallback on public.voice_explanations;
drop trigger if exists voice_evidence_immutable on public.voice_explanations;
drop trigger if exists bind_voice_submission on public.voice_explanations;
drop function if exists public.voice_authority_fallback();
drop function if exists public.voice_evidence_immutable();
drop function if exists public.bind_voice_to_submission();
drop function if exists public.withdraw_voice_explanation(uuid);
create policy voice_own_delete on public.voice_explanations for delete to authenticated
  using (student_id = (select auth.uid()));
drop index if exists public.voice_one_authoritative_per_submission;
drop index if exists public.voice_explanations_submission_idx;
commit;
-- Then re-apply the company_submissions() and recruiter_lots() definitions from
-- migration/54-company-submissions-on-task-submissions.sql (they do not read the new columns),
-- and only after that:
--   alter table public.voice_explanations drop column submission_id, drop column attempt_no,
--     drop column current_authoritative, drop column withdrawn_at, drop column evaluation;
notify pgrst, 'reload schema';
