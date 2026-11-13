-- 510 (N2, 13 Nov 2026): company Talent said a student was last active "today" while his profile said "yesterday".
-- recruiter_proof_profile runs in India time (set TimeZone 'Asia/Kolkata'); recruiter_talent did not, so its
-- current_date and last_active::date were UTC days. touch_my_activity's "once a day" also reset at 05:30 IST.
-- Fix: run both in India time. Bodies are unchanged (only the function setting), so nothing else moves.
-- Rollback: migration/510-rollback-india-day-last-active.sql
begin;

alter function public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer) set timezone to 'Asia/Kolkata';
alter function public.touch_my_activity() set timezone to 'Asia/Kolkata';

do $$
begin
  if not exists (select 1 from pg_proc where oid = 'public.recruiter_talent(text, text[], text, integer, integer, integer, integer, integer)'::regprocedure
                  and array_to_string(proconfig, ',') ilike '%timezone=Asia/Kolkata%')
     or not exists (select 1 from pg_proc where oid = 'public.touch_my_activity()'::regprocedure
                  and array_to_string(proconfig, ',') ilike '%timezone=Asia/Kolkata%') then
    raise exception '510 self-check: India time zone not set';
  end if;
  raise notice '510 self-check: true';
end $$;
notify pgrst, 'reload schema';
commit;
