-- 176 (MF-038, 30 Oct 2026): a student who finishes onboarding is no longer "invited" forever.
--   Nothing set student_profiles.onboarding_status to 'completed' when the student finished the intake, so
--   61 of 62 TEST students stayed "invited" and every college list said "Needs attention".
--   A trigger on student_intake now marks the profile completed (and onboarded_at) the moment
--   intake_completed_at is set; students who already finished are marked now. A 'blocked' student is left alone.
-- Rollback: migration/176-rollback-onboarding-completed.sql
begin;

create or replace function public.intake_marks_onboarded()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.intake_completed_at is not null
     and (tg_op = 'INSERT' or old.intake_completed_at is null) then
    perform set_config('app.system_write', 'on', true);
    update public.student_profiles
       set onboarding_status = 'completed',
           onboarded_at = coalesce(onboarded_at, new.intake_completed_at)
     where id = new.user_id and onboarding_status = 'invited';
    perform set_config('app.system_write', 'off', true);
  end if;
  return new;
end $fn$;

drop trigger if exists student_intake_marks_onboarded on public.student_intake;
create trigger student_intake_marks_onboarded
  after insert or update of intake_completed_at on public.student_intake
  for each row execute function public.intake_marks_onboarded();

-- Students who already finished.
select set_config('app.system_write', 'on', true);
update public.student_profiles p
   set onboarding_status = 'completed',
       onboarded_at = coalesce(p.onboarded_at, i.intake_completed_at)
  from public.student_intake i
 where i.user_id = p.id and i.intake_completed_at is not null and p.onboarding_status = 'invited';
select set_config('app.system_write', 'off', true);

do $$
begin
  if exists (select 1 from public.student_profiles p join public.student_intake i on i.user_id = p.id
              where i.intake_completed_at is not null and p.onboarding_status = 'invited') then
    raise exception '176: a student who finished onboarding is still invited';
  end if;
end $$;

commit;
