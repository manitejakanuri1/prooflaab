-- ROLLBACK for 150: the proof_verified squad rule, the "Ship Something" quest and the event type come back.
-- Values are the ones live on TEST before 150 (rule: 25 points; quest: weekly, target 1, 80 XP).
begin;
alter table public.student_activity_events drop constraint student_activity_events_event_type_check;
alter table public.student_activity_events add constraint student_activity_events_event_type_check
  check (event_type = any (array['login', 'lot_started', 'lot_submitted', 'voice_recorded', 'topic_cleared',
                                 'proof_submitted', 'proof_verified', 'skill_assessed', 'profile_updated', 'match_participated']));
insert into public.quests (slug, name, description, cadence, metric, target, xp_reward, is_active)
values ('weekly-proof', 'Ship Something', 'Get one piece of work verified this week.', 'weekly', 'proof_verified', 1, 80, true)
on conflict (slug) do nothing;
insert into public.squad_scoring_rules (id, metric, label, points, description, college_id)
values ('9c67e73b-359b-4dc1-809c-a5e3f6f781e7', 'proof_verified', 'Proof verified', 25,
        'Work that survived checking - the most a student can be worth in a week.', null)
on conflict do nothing;
commit;

notify pgrst, 'reload schema';
