-- 135: Badges and quests work again, worked out from the student's real activity.
--
-- WHY. Found on staging 23 Oct 2026: Profile -> Badges showed "0 of 0". The badge and quest lists were
-- empty, and the award engine that filled student_badges / student_quests (record_activity and its
-- triggers, Supabase era) is not in the Google Cloud database at all. Nothing could ever be earned.
-- NOW.
-- 1. The original 10 badges and 7 quests (stage 11 + stage 69 wording) are loaded; existing rows are kept.
-- 2. my_achievements() - the caller's own, nobody else's - works everything out from stored facts:
--      badges   topics cleared (student_levels cleared/mastered; resume ticks 'placed' do not count),
--               longest streak, verified work (passed task_submissions), a whole phase cleared.
--               A newly earned badge is saved once in student_badges with the time it was first seen.
--      quests   today's / this week's (Monday, India time) counts of Lots submitted, voice recorded,
--               topics cleared and work passed. Shown as progress only: quests pay no XP here (XP is
--               paid where the work is graded), so the page no longer promises any.
-- Rollback: migration/135-rollback-badges-and-quests-from-real-work.sql
begin;

insert into public.badges (slug, name, emoji, description, rule_kind, rule_value) values
  ('first-blood',    'First Blood',      '🩸', 'Cleared your first topic. It only gets better from here.',         'level',  1),
  ('ten-down',       'Ten Down',         '🔟', 'Ten topics cleared. You are past the part where people quit.',     'level',  10),
  ('twenty-five',    'Quarter Century',  '🎯', 'Twenty-five topics. That is a real skill now, not a claim.',       'level',  25),
  ('week-warrior',   'Week Warrior',     '🔥', 'Seven days in a row. Consistency beats intensity.',                'streak', 7),
  ('month-machine',  'Month Machine',    '⚡', 'Thirty days without breaking the chain. Genuinely hard.',          'streak', 30),
  ('century-streak', 'Hundred Club',     '💯', 'One hundred days. At this point it is who you are.',               'streak', 100),
  ('first-proof',    'Proven Once',      '✅', 'Your first verified proof. Someone checked, and it held up.',      'proof',  1),
  ('five-proofs',    'Five Deep',        '🧱', 'Five verified proofs. A build-log a recruiter can actually read.', 'proof',  5),
  ('twenty-proofs',  'Portfolio Weight', '🏗️', 'Twenty verified proofs. This is a body of work.',                  'proof',  20),
  ('phase-clear',    'Phase Cleared',    '🚪', 'Finished a whole phase of your path.',                             'phase',  1)
on conflict (slug) do nothing;

insert into public.quests (slug, name, description, cadence, metric, target, xp_reward, is_active) values
  ('daily-lot',        'Today''s Lot',             'Submit the Lot waiting on your Daily Card.',         'daily',  'lot_submitted',  1, 20, true),
  ('daily-explain',    'Say It Out Loud',          'Record one 60-second explanation of your own work.', 'daily',  'voice_recorded', 1, 15, true),
  ('daily-topic',      'One Topic Down',           'Clear one topic checkpoint on your roadmap.',        'daily',  'topic_cleared',  1, 15, true),
  ('weekly-three',     'Three For The Week',       'Clear three topics this week.',                      'weekly', 'topic_cleared',  3, 60, true),
  ('weekly-proof',     'Ship Something',           'Get one piece of work verified this week.',          'weekly', 'proof_verified', 1, 80, true),
  ('weekly-five-lots', 'Five Lots',                'Submit five daily Lots this week.',                  'weekly', 'lot_submitted',  5, 100, true),
  ('weekly-task',      'Pass an auto-graded task', 'Pass one auto-graded task this week',                'weekly', 'task_completed', 1, 80, true)
on conflict (slug) do nothing;

create or replace function public.my_achievements()
returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  me      uuid := (select auth.uid());
  today   date := (now() at time zone 'Asia/Kolkata')::date;
  monday  date := today - (extract(isodow from today)::int - 1);
  topics  int; streak int; proofs int; phases int;
begin
  if me is null or not exists (select 1 from public.student_profiles where id = me) then
    return jsonb_build_object('earned', '[]'::jsonb, 'quests', '[]'::jsonb);
  end if;

  select count(*) into topics from public.student_levels where student_id = me and status in ('cleared', 'mastered');
  select coalesce(max(longest_days), 0) into streak from public.student_streaks where student_id = me;
  select count(distinct task_id) into proofs from public.task_submissions where student_id = me and status = 'passed';
  select count(*) into phases
    from public.track_phases ph
    join public.student_tracks st on st.track_slug = ph.track_slug and st.student_id = me
   where not exists (select 1 from public.levels l
                      where l.track_slug = ph.track_slug and l.sub_level = 1
                        and l.level_number between ph.from_level and ph.to_level
                        and not exists (select 1 from public.student_levels sl
                                         where sl.student_id = me and sl.level_id = l.id
                                           and sl.status in ('cleared', 'mastered')))
     and exists (select 1 from public.levels l where l.track_slug = ph.track_slug and l.sub_level = 1
                   and l.level_number between ph.from_level and ph.to_level);

  insert into public.student_badges (student_id, badge_slug)
  select me, b.slug from public.badges b
   where (b.rule_kind = 'level'  and topics >= b.rule_value)
      or (b.rule_kind = 'streak' and streak >= b.rule_value)
      or (b.rule_kind = 'proof'  and proofs >= b.rule_value)
      or (b.rule_kind = 'phase'  and phases >= b.rule_value)
  on conflict do nothing;

  return jsonb_build_object(
    'earned', coalesce((select jsonb_agg(jsonb_build_object('badge_slug', badge_slug, 'awarded_at', awarded_at))
                          from public.student_badges where student_id = me), '[]'::jsonb),
    'quests', coalesce((
      select jsonb_agg(jsonb_build_object('quest_slug', q.slug, 'progress', least(n.c, q.target), 'done', n.c >= q.target))
        from public.quests q
        cross join lateral (select case q.metric
            when 'lot_submitted' then (select count(distinct s.task_id) from public.task_submissions s join public.tasks t on t.id = s.task_id
                                        where s.student_id = me and t.lot_date is not null
                                          and (s.created_at at time zone 'Asia/Kolkata')::date >= case q.cadence when 'daily' then today else monday end)
            when 'voice_recorded' then (select count(*) from public.voice_explanations v
                                        where v.student_id = me
                                          and (v.created_at at time zone 'Asia/Kolkata')::date >= case q.cadence when 'daily' then today else monday end)
            when 'topic_cleared' then (select count(*) from public.student_levels sl
                                        where sl.student_id = me and sl.status in ('cleared', 'mastered')
                                          and (coalesce(sl.cleared_at, sl.mastered_at) at time zone 'Asia/Kolkata')::date >= case q.cadence when 'daily' then today else monday end)
            else (select count(distinct s.task_id) from public.task_submissions s
                   where s.student_id = me and s.status = 'passed'
                     and (s.created_at at time zone 'Asia/Kolkata')::date >= case q.cadence when 'daily' then today else monday end)
          end::int as c) n
       where q.is_active), '[]'::jsonb));
end $function$;

revoke all on function public.my_achievements() from public, anon;
grant execute on function public.my_achievements() to authenticated, service_role;

do $$ begin
  if (select count(*) from public.badges) < 10 then raise exception '135: badges not loaded'; end if;
  if (select count(*) from public.quests where is_active) < 7 then raise exception '135: quests not loaded'; end if;
  if has_function_privilege('anon', 'public.my_achievements()', 'EXECUTE') then raise exception '135: anon can call my_achievements'; end if;
end $$;
commit;
notify pgrst, 'reload schema';
