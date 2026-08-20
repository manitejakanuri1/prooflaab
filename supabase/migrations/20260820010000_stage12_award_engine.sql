-- ============================================================================
-- The award engine.
--
-- Badges and quests existed as tables and as a screen, with nothing behind
-- them. A student could work for a month and the badge wall would still read
-- 0 of 10, because the only code touching student_badges was the screen that
-- reads it. Same for quests: the progress bars could never move.
--
-- That is the difference between a table existing and a feature working.
--
-- Badges are re-derived by COUNTING the source tables every time rather than
-- kept in a counter. A counter drifts the first time anything is deleted or
-- replayed; a count of what actually happened cannot.
-- ============================================================================

create or replace function public.record_activity(
  _student_id uuid,
  _metric     text   -- lot_submitted | voice_recorded | topic_cleared
                     -- quiz_passed  | proof_verified
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  q record; b record; period date;
  have integer; topics integer; proofs integer; streak integer;
begin
  if _student_id is null then return; end if;

  -- Submitting work and explaining work are both work; the day counts either
  -- way, and doing both twice does not count twice.
  perform public.touch_streak(_student_id);

  for q in select * from public.quests where is_active and metric = _metric loop
    period := case when q.cadence = 'daily'
                   then current_date
                   else date_trunc('week', current_date)::date end;

    insert into public.student_quests (student_id, quest_slug, period_start, progress)
    values (_student_id, q.slug, period, 1)
    on conflict (student_id, quest_slug, period_start) do update
      -- Stops at the target rather than climbing past it, so a finished quest
      -- reads 3/3 and not 7/3.
      set progress = least(public.student_quests.progress + 1, q.target);

    update public.student_quests sq
       set completed_at = now()
     where sq.student_id = _student_id and sq.quest_slug = q.slug
       and sq.period_start = period and sq.progress >= q.target
       and sq.completed_at is null;

    -- XP is paid once, on the transition to complete.
    if found then
      insert into public.xp_logs (student_id, xp_points, source)
      values (_student_id, q.xp_reward, 'quest:' || q.slug);
      update public.student_profiles set total_xp = total_xp + q.xp_reward
       where id = _student_id;
    end if;
  end loop;

  select count(*) into topics from public.student_levels
   where student_id = _student_id and status in ('cleared', 'mastered');
  select count(*) into proofs from public.proof_uploads
   where student_id = _student_id and status = 'Verified';
  select coalesce(current_days, 0) into streak from public.student_streaks
   where student_id = _student_id;

  for b in select * from public.badges loop
    have := case b.rule_kind
              when 'level'  then topics
              when 'proof'  then proofs
              when 'streak' then streak
              else 0 end;
    if b.rule_value is not null and have >= b.rule_value then
      insert into public.student_badges (student_id, badge_slug)
      values (_student_id, b.slug)
      on conflict (student_id, badge_slug) do nothing;
    end if;
  end loop;
end $fn$;

-- Never callable from a browser. A student who could pass their own metric
-- would award themselves everything.
revoke all on function public.record_activity(uuid, text) from public, anon, authenticated;


-- Triggers rather than calls from the edge functions, so an action counts no
-- matter which path created it — the app, an admin screen, or a backfill.
create or replace function public.on_proof_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.record_activity(new.student_id, 'lot_submitted');
  elsif new.status = 'Verified' and old.status is distinct from 'Verified' then
    perform public.record_activity(new.student_id, 'proof_verified');
  end if;
  return new;
end $fn$;

create trigger proof_uploads_record_activity
  after insert or update of status on public.proof_uploads
  for each row execute function public.on_proof_change();

create or replace function public.on_voice_recorded()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform public.record_activity(new.student_id, 'voice_recorded');
  return new;
end $fn$;

create trigger voice_explanations_record_activity
  after insert on public.voice_explanations
  for each row execute function public.on_voice_recorded();

create or replace function public.on_level_cleared()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.status in ('cleared', 'mastered') and old.status is distinct from new.status then
    perform public.record_activity(new.student_id, 'topic_cleared');
  end if;
  return new;
end $fn$;

create trigger student_levels_record_activity
  after update of status on public.student_levels
  for each row execute function public.on_level_cleared();
