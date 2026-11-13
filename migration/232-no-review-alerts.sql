-- 232 (Purna 12 Nov 2026, after 229): no more "Answers waiting for review" alerts.
--   229 ended the review step, but notify_pending_reviews() still wrote a daily digest pointing at
--   Students > Flagged Submissions / Work > Flags & reviews (both removed): a dead link, and the admin bell's red count.
--   1. Every review_digest notification is copied to public.backup_review_digest_20261112 (a copy only).
--      Purna 13 Nov 2026: the old alerts are NOT deleted (delete nothing on REAL); no new ones are made.
--   2. notify_pending_reviews() writes nothing (kept, so scheduled-job's call still answers).
-- Rollback: migration/232-rollback-no-review-alerts.sql
begin;
create table if not exists public.backup_review_digest_20261112 as
  select * from public.notifications where type = 'review_digest';
alter table public.backup_review_digest_20261112 enable row level security;

create or replace function public.notify_pending_reviews()
returns jsonb language sql security definer set search_path to 'public', 'pg_temp' as $f$
  -- 232: nothing waits for a person since 229; no digest.
  select jsonb_build_object('pending', 0, 'admins', 0, 'colleges', 0);
$f$;

do $$
begin
  if (public.notify_pending_reviews() ->> 'pending') <> '0' then
    raise exception '232 self-check: notify_pending_reviews still counts';
  end if;
end $$;
commit;
