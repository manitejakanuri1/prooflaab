-- Proactively notify students the moment their 3-day retest cooldown ends,
-- instead of relying on them to check back manually (resume-retest-generate
-- only fires on-demand). Cooldown window here mirrors COOLDOWN_DAYS in
-- supabase/functions/resume-retest-generate/index.ts -- keep both in sync.

alter table public.resume_assessments
  add column if not exists retest_notified_at timestamptz;

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

create or replace function public.notify_retest_unlocks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  weak_count int;
begin
  for r in
    select ra.id, ra.student_id, ra.answer_scores, rc.target_role
    from public.resume_assessments ra
    join public.resume_claims rc on rc.id = ra.resume_claims_id
    where ra.status = 'graded'
      and ra.updated_at <= now() - interval '3 days'
      and (ra.retest_notified_at is null or ra.retest_notified_at < ra.updated_at)
  loop
    select count(*) into weak_count
    from jsonb_array_elements(coalesce(r.answer_scores, '[]'::jsonb)) elem
    where (elem->>'final_score')::numeric < 70;

    if weak_count > 0 then
      insert into public.notifications (student_id, type, title, message, link, is_read)
      values (
        r.student_id,
        'task',
        'Retest unlocked',
        'Your 3-day study window is up -- retake the weak-topic retest for ' ||
          coalesce(r.target_role, 'your target role') || ' while it''s fresh.',
        '/student/resume-onboarding',
        false
      );
    end if;

    update public.resume_assessments set retest_notified_at = now() where id = r.id;
  end loop;
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'notify-retest-unlocks';

select cron.schedule(
  'notify-retest-unlocks',
  '*/15 * * * *',
  $$select public.notify_retest_unlocks();$$
);
