-- Rollback of 170: the streak moves on any activity again, by the database (UTC) date.
begin;

create or replace function public.touch_streak(_student_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare last_on date;
begin
  select last_active_on into last_on from public.student_streaks where student_id = _student_id;

  if last_on = current_date then
    return;                                  -- already counted today
  end if;

  insert into public.student_streaks (student_id, current_days, longest_days, last_active_on)
  values (_student_id, 1, 1, current_date)
  on conflict (student_id) do update set
    -- Yesterday continues the run; any longer gap starts a new one.
    current_days = case when (public.student_streaks.last_active_on = current_date - 1 or (extract(isodow from current_date) = 1 and public.student_streaks.last_active_on = current_date - 2))
                        then public.student_streaks.current_days + 1
                        else 1 end,
    longest_days = greatest(
      public.student_streaks.longest_days,
      case when (public.student_streaks.last_active_on = current_date - 1 or (extract(isodow from current_date) = 1 and public.student_streaks.last_active_on = current_date - 2))
           then public.student_streaks.current_days + 1
           else 1 end),
    last_active_on = current_date,
    updated_at = now();
end $fn$;

create or replace function public.activity_from_lot()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.status = 'completed' and new.lot_date is not null
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.log_activity(new.student_id, 'lot_submitted', 'tasks', new.id);
  end if;
  return new;
end $fn$;

commit;
