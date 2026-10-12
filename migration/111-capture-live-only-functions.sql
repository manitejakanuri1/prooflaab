-- 111: two functions the website calls exist in the live databases but in no migration file (Sidhu S41).
--
--   complete_own_wizard()  src/pages/OnboardingWizard.tsx    a new student finishes onboarding
--   touch_my_activity()    src/pages/StudentDashboard.tsx    the daily "active" mark colleges see
-- and two activity triggers found by diffing the staging schema against the migrations (see below).
-- (Not captured: the tables verification_settings / manual_adjustment_log, which migration 94 drops and staging has
-- not run yet. generate_round_robin was first reported live-only by mistake: stage 37 creates its three-argument
-- form and only drops the old two-argument one; the drift check now tells overloads apart.)
--
-- Found by scripts/dev-tools/sidhu_s41_contract_drift.mjs (every frontend call against the repository); TEJA's
-- S34 notes had already seen them in the live schema snapshot. Anything rebuilt from the migrations (disaster
-- recovery, a new environment) lacked both, so onboarding would never finish and no student would ever count as
-- active. The bodies and grants below are the staging definitions read on 13 Oct 2026 (pg_get_functiondef,
-- read-only), unchanged. Where the functions already exist this changes nothing (same body, CREATE OR REPLACE keeps
-- the grants); where they are missing it creates them.
-- Rollback: 111-rollback-capture-live-only-functions.sql (a note: nothing is removed).
begin;

create or replace function public.complete_own_wizard()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare me uuid := (select auth.uid());
begin
  if me is null then raise exception 'not signed in'; end if;
  update public.user_roles set has_completed_wizard = true where user_id = me;
  -- A student finishing the wizard has finished onboarding, which is what the
  -- college's "who has not started yet" list is counting.
  update public.student_profiles
     set onboarding_status = case when onboarding_status = 'invited'
                                  then 'in_progress' else onboarding_status end
   where id = me and onboarding_status = 'invited';
end $function$;

create or replace function public.touch_my_activity()
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare me uuid := (select auth.uid());
begin
  if me is null then return; end if;
  if not exists (select 1 from public.student_profiles where id = me) then return; end if;
  -- Once a day. A student refreshing the page forty times has been active once.
  if exists (select 1 from public.student_activity_events
              where student_id = me and event_type = 'login'
                and occurred_at >= current_date) then
    return;
  end if;
  perform public.log_activity(me, 'login');
end $function$;

-- Two triggers that write the student activity log (what college insights and "last active" read) were also only
-- live: a Lot marked completed, and a voice recording. Same definitions as staging, 13 Oct 2026.
create or replace function public.activity_from_assignment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.log_activity(new.student_id, 'lot_submitted', 'task_assignments', new.id);
  end if;
  return new;
end $function$;

create or replace function public.activity_from_voice()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.log_activity(new.student_id, 'voice_recorded', 'voice_explanations', new.id);
  return new;
end $function$;

drop trigger if exists task_assignments_activity on public.task_assignments;
create trigger task_assignments_activity after insert or update on public.task_assignments
  for each row execute function public.activity_from_assignment();
drop trigger if exists voice_explanations_activity on public.voice_explanations;
create trigger voice_explanations_activity after insert on public.voice_explanations
  for each row execute function public.activity_from_voice();

-- The live grants (staging, 13 Oct): signed-in users call both; the backend may too.
grant execute on function public.complete_own_wizard() to authenticated, service_role;
grant execute on function public.touch_my_activity() to authenticated, service_role;

do $$
begin
  if not has_function_privilege('authenticated', 'public.complete_own_wizard()', 'execute')
     or not has_function_privilege('authenticated', 'public.touch_my_activity()', 'execute') then
    raise exception '111 self-check: a signed-in user cannot call the functions the website calls';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.complete_own_wizard()'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'public.touch_my_activity()'::regprocedure) then
    raise exception '111 self-check: both must run as their owner (they write rows the caller cannot)';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal
        and tgname in ('task_assignments_activity', 'voice_explanations_activity')) <> 2 then
    raise exception '111 self-check: an activity trigger is missing';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
