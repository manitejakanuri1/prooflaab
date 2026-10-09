-- 106 rollback: removes the consent guard only.
-- After this an administrator can again switch a student's audio sharing on, so every student is switched off
-- first. remove_students() is deliberately NOT put back to what migration 105 wrote: that body reads a retired
-- table and loses the student's submissions from the removal backup. Column login_deleted_at is kept.
-- To switch the S34 controls off completely, run 105-rollback-live-controls.sql after this.
begin;

update public.student_profiles set share_voice_audio = false where share_voice_audio;
drop trigger if exists student_profiles_guard_share_voice_audio on public.student_profiles;
drop function if exists public.guard_share_voice_audio();

commit;
notify pgrst, 'reload schema';
