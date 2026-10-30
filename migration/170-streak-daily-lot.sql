-- 170 (owner decision 3, 30 Oct 2026): the streak goes up ONLY on a day the student finished that day's
--   Daily Lot - both parts, the written/code answer AND the voice (the Lot's status is then 'completed').
--   Before: any scored voice, any mock interview, any topic clear and any quest activity moved the streak
--   (voiceScore.ts, mock-interview-score, on_level_cleared / on_voice_recorded -> record_activity).
--   All of those still call touch_streak; touch_streak now refuses unless today's Lot is completed, so one
--   guard covers every caller. The Lot itself moves the streak the moment it becomes 'completed'.
--   "Today" is the India date (Asia/Kolkata), not the database's UTC date.
-- Rollback: migration/170-rollback-streak-daily-lot.sql
begin;

create or replace function public.touch_streak(_student_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  last_on date;
begin
  -- 170: only a finished Daily Lot (written/code AND voice) for today counts.
  if not exists (select 1 from public.tasks t
                  where t.student_id = _student_id and t.lot_date = today and t.status = 'completed') then
    return;
  end if;

  select last_active_on into last_on from public.student_streaks where student_id = _student_id;
  if last_on = today then
    return;                                  -- already counted today
  end if;

  insert into public.student_streaks (student_id, current_days, longest_days, last_active_on)
  values (_student_id, 1, 1, today)
  on conflict (student_id) do update set
    -- Yesterday continues the run (Saturday continues into Monday); any longer gap starts a new one.
    current_days = case when (public.student_streaks.last_active_on = today - 1
                              or (extract(isodow from today) = 1 and public.student_streaks.last_active_on = today - 2))
                        then public.student_streaks.current_days + 1
                        else 1 end,
    longest_days = greatest(
      public.student_streaks.longest_days,
      case when (public.student_streaks.last_active_on = today - 1
                 or (extract(isodow from today) = 1 and public.student_streaks.last_active_on = today - 2))
           then public.student_streaks.current_days + 1
           else 1 end),
    last_active_on = today,
    updated_at = now();
end $fn$;

-- The Lot moves the streak as soon as both parts are done.
create or replace function public.activity_from_lot()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.status = 'completed' and new.lot_date is not null
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.log_activity(new.student_id, 'lot_submitted', 'tasks', new.id);
    perform public.touch_streak(new.student_id);
  end if;
  return new;
end $fn$;

do $$
begin
  if pg_get_functiondef('public.touch_streak(uuid)'::regprocedure) !~ 'lot_date = today'
     or pg_get_functiondef('public.activity_from_lot()'::regprocedure) !~ 'touch_streak' then
    raise exception '170: streak is not tied to the Daily Lot';
  end if;
end $$;

commit;
