-- 146: per-topic rating, step one - record graded Lots, show the student where they are strong or weak
-- (owner decision 26 Oct 2026). Record and display ONLY: next_lot_pick is not changed (Daily Lots rule:
-- ROADMAP != DAILY LOTS stays).
--
-- WHAT EXISTED. Migration 55 made topic_ratings, record_topic_attempt() and topic_priorities(). The topic
-- quiz (level-quiz-submit) has recorded one attempt per question since stage 68. Nothing recorded graded
-- Lots, and nothing showed the result to the student.
--
-- NOW.
--   1. topic_rating_log: one row per (submission, skill) already counted, so a status change on a submission
--      (needs_review -> passed after a review) can never count the same Lot twice.
--   2. record_lot_topic_rating(submission): a passed submission is a 'correct' attempt, a failed one is
--      'incorrect', for each skill the Lot is tagged with (lot_candidates.skills, else tag_skills of the task
--      text; at most 3 skills). Only daily Lots (tasks.lot_date set), never a task the student made for
--      themselves, never needs_review (it counts when a person settles it).
--   3. A trigger on task_submissions calls it. It cannot fail the student's submission: any error is
--      reported as a WARNING and swallowed.
--   4. my_topic_ratings(): the student's own topics as a label (strong / building / needs_work / new),
--      accuracy and attempts. The raw rating is NOT returned (Master Specification v2 section 18: hidden).
--      Accuracy is exact: record_topic_attempt moves +25 per correct and -8 per incorrect attempt, so
--      correct = (rating - 1200 + 8 * attempts) / 33. It is approximate only for a rating pinned at 800 or 2200.
--   5. topic_priorities(student, limit) was executable by any signed-in student for ANY student id. It is now
--      server-only (nothing in the website calls it).
-- Rollback: migration/146-rollback-topic-rating-wiring.sql
begin;

create table if not exists public.topic_rating_log (
  source     text primary key,                 -- 'lot:<submission id>:<skill>'
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.topic_rating_log enable row level security;
revoke all on public.topic_rating_log from public, anon, authenticated;
grant select, insert on public.topic_rating_log to service_role;

create or replace function public.record_lot_topic_rating(_submission_id uuid)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  s       record;
  sk_list text[];
  sk      text;
  counted integer := 0;
  fresh   integer;
begin
  select ts.id, ts.student_id, ts.status, t.title, t.description, t.lot_date, t.lot_candidate_id, t.inserted_by
    into s
    from public.task_submissions ts
    join public.tasks t on t.id = ts.task_id
   where ts.id = _submission_id;
  if not found then return 0; end if;
  if s.status not in ('passed', 'failed') then return 0; end if;     -- needs_review waits for a person
  if s.lot_date is null then return 0; end if;                       -- daily Lots only
  if s.inserted_by is not null and s.inserted_by = s.student_id then return 0; end if;  -- self-authored: never evidence

  select c.skills into sk_list from public.lot_candidates c where c.id = s.lot_candidate_id;
  if sk_list is null or cardinality(sk_list) = 0 then
    sk_list := public.tag_skills(coalesce(s.title, '') || ' ' || coalesce(s.description, ''));
  end if;
  if sk_list is null or cardinality(sk_list) = 0 then return 0; end if;

  foreach sk in array sk_list[1:3] loop
    insert into public.topic_rating_log (source, student_id)
    values ('lot:' || s.id || ':' || sk, s.student_id)
    on conflict (source) do nothing;
    get diagnostics fresh = row_count;
    if fresh > 0 then
      perform public.record_topic_attempt(s.student_id, sk,
                                          case when s.status = 'passed' then 'correct' else 'incorrect' end,
                                          null, null);
      counted := counted + 1;
    end if;
  end loop;
  return counted;
end $fn$;

create or replace function public.task_submissions_topic_rating()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  begin
    if new.status in ('passed', 'failed')
       and (tg_op = 'INSERT' or old.status is distinct from new.status) then
      perform public.record_lot_topic_rating(new.id);
    end if;
  exception when others then
    -- a rating problem must never cost the student the submission they just made
    raise warning 'topic rating skipped for submission %: %', new.id, sqlerrm;
  end;
  return new;
end $fn$;

drop trigger if exists task_submissions_topic_rating on public.task_submissions;
create trigger task_submissions_topic_rating
  after insert or update of status on public.task_submissions
  for each row execute function public.task_submissions_topic_rating();

create or replace function public.my_topic_ratings()
returns table (topic text, label text, accuracy_pct integer, attempts integer, last_seen timestamptz)
language sql stable security definer set search_path = public, pg_temp as $fn$
  with r as (
    select t.topic, t.attempts, t.last_seen,
           greatest(0, least(t.attempts, round((t.rating - 1200 + 8 * t.attempts)::numeric / 33)))::integer as correct
      from public.topic_ratings t
     where t.student_id = (select auth.uid())
  )
  select r.topic,
         case when r.attempts < 3 then 'new'
              when r.correct::numeric / r.attempts >= 0.75 then 'strong'
              when r.correct::numeric / r.attempts < 0.5  then 'needs_work'
              else 'building' end,
         round(100.0 * r.correct / nullif(r.attempts, 0))::integer,
         r.attempts, r.last_seen
    from r
   order by case when r.attempts < 3 then 3
                 when r.correct::numeric / r.attempts >= 0.75 then 0
                 when r.correct::numeric / r.attempts < 0.5  then 1 else 2 end,
            r.attempts desc, r.topic;
$fn$;

revoke all on function public.record_lot_topic_rating(uuid), public.task_submissions_topic_rating(),
  public.my_topic_ratings() from public, anon, authenticated;
grant execute on function public.record_lot_topic_rating(uuid) to service_role;
grant execute on function public.my_topic_ratings() to authenticated, service_role;

-- topic_priorities answered for any student id; nothing in the website calls it. Server-only now.
revoke execute on function public.topic_priorities(uuid, integer) from authenticated;

do $$
begin
  if has_function_privilege('authenticated', 'public.topic_priorities(uuid,integer)', 'execute') then
    raise exception '146 self-check: students can still read any student''s topic priorities';
  end if;
  if has_function_privilege('authenticated', 'public.record_lot_topic_rating(uuid)', 'execute') then
    raise exception '146 self-check: students can record their own topic rating';
  end if;
  if not has_function_privilege('authenticated', 'public.my_topic_ratings()', 'execute') then
    raise exception '146 self-check: students cannot read their own topic ratings';
  end if;
  if has_table_privilege('authenticated', 'public.topic_rating_log', 'select') then
    raise exception '146 self-check: the rating log is readable directly';
  end if;
  -- No caller inside the migration: no rows.
  if exists (select 1 from public.my_topic_ratings()) then
    raise exception '146 self-check: my_topic_ratings returned rows without a caller';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
