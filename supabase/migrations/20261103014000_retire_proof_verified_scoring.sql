-- 150: "proof verified" can no longer be earned, so it stops being offered (owner, 27 Oct 2026).
-- Daily Lots and coding write task_submissions; proof_uploads and on_proof_change() were removed with the
-- rest of the proof era (20261103001600_retire_proof_era_objects). Nothing writes a proof_verified event
-- (0 rows on TEST), so the 25-point squad rule and the "Ship Something" quest (80 XP) were dead.
-- proof_submitted stays in the event list: it is outside this change.
-- Rollback: migration/150-rollback-retire-proof-verified-scoring.sql
begin;

do $$ begin
  if exists (select 1 from public.student_activity_events where event_type = 'proof_verified') then
    raise exception '150: proof_verified events exist; they would be stranded';
  end if;
end $$;

delete from public.squad_scoring_rules where metric = 'proof_verified';
delete from public.quests where slug = 'weekly-proof';  -- student_quests rows cascade (0 on TEST)

alter table public.student_activity_events drop constraint student_activity_events_event_type_check;
alter table public.student_activity_events add constraint student_activity_events_event_type_check
  check (event_type = any (array['login', 'lot_started', 'lot_submitted', 'voice_recorded', 'topic_cleared',
                                 'proof_submitted', 'skill_assessed', 'profile_updated', 'match_participated']));

do $$ begin
  if exists (select 1 from public.squad_scoring_rules where metric = 'proof_verified')
     or exists (select 1 from public.quests where metric = 'proof_verified') then
    raise exception '150 self-check: proof_verified is still scored';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
