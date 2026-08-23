-- ============================================================================
-- Stage 26 — the notice at the end of the retest cooldown.
--
-- A cron job named notify-retest-unlocks has been running every fifteen minutes
-- against a function that does not exist: 820 failed runs, 96 a day, since the
-- rebuild dropped the function and left the schedule behind.
--
-- The feature it belongs to is real and was half-built. resume_assessments
-- carries retest_notified_at, the retest itself works, and it unlocks three days
-- after grading — but nothing ever told the student the wait was over, so the
-- only way to find out was to keep pressing a button that had been refusing
-- them.
--
-- Rebuilt rather than deleted: the column and the cooldown were both deliberate
-- and only the notice was missing.
-- ============================================================================

create or replace function public.notify_retest_unlocks()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare a record; sent integer := 0;
begin
  for a in
    select ra.id, ra.student_id
      from public.resume_assessments ra
     where ra.status = 'graded'
       and ra.retest_notified_at is null
       -- Three days, matching COOLDOWN_DAYS in resume-retest-generate. Measured
       -- from the grading, which is the last thing that touches the row.
       and ra.updated_at <= now() - interval '3 days'
  loop
    insert into public.notifications
      (user_id, audience, source, type, title, message, link)
    values (
      a.student_id, 'student', 'system', 'retest_unlocked',
      'Your retest is open',
      'Three days on the roadmap later, you can retake the topics you scored weak on. ' ||
      'Same concepts, different questions.',
      '/student/dashboard');

    update public.resume_assessments set retest_notified_at = now() where id = a.id;
    sent := sent + 1;
  end loop;

  return jsonb_build_object('ok', true, 'notified', sent, 'ran_at', now());
end $fn$;

revoke all on function public.notify_retest_unlocks() from public, anon, authenticated;

-- The job runs 96 times a day and this keeps every one of those runs an index
-- scan over the handful of rows that are actually waiting.
create index if not exists resume_assessments_retest_pending_idx
  on public.resume_assessments (updated_at)
  where status = 'graded' and retest_notified_at is null;
