-- 104: AI-first assessment, exceptional human review, and safe review resolution (S31).
-- Requires 103 (task provenance). Keeps 91/93/103 untouched: record_task_submission is not changed here.
--
--   1. similar_written_answer(task, student, answer): similarity ONLY to other students' passed/pending answers to
--      the SAME question (same checklist AND same task title + description), plus how much of the answer merely
--      restates the prompt/reference (word_similarity) and its length. submit-written-task flags a copy only when
--      all three say so (_shared/review-policy.ts). The old similar_written_submission() is left in place, unused.
--   2. review_task_submission (migration 86's body, three anchored edits): the row is locked (FOR UPDATE) so it
--      resolves exactly once; a review whose task a later attempt already passed is closed without a second
--      pass or XP (it used to fail on the one-pass index and stay in the queue forever); the student is told
--      the outcome in neutral words.
--   3. notify_review_outcome(): one notification per submission (dedupe_key), never an accusation.
--   4. notify_pending_reviews(): at most ONE digest per reviewer per IST day (dedupe_key, migration 40's index)
--      to admins and to each approved, active college with answers from its own students waiting.
-- No table, column, policy or existing row changes. Rollback: 104-rollback-*.sql.
begin;

create or replace function public.similar_written_answer(_task_id uuid, _student_id uuid, _answer text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with q as (
    select t.rubric_config_id,
           md5(coalesce(t.title, '') || '|' || coalesce(t.description, '')) as question,
           coalesce(t.title, '') || ' ' || coalesce(t.description, '') || ' '
             || coalesce(c.prompt_text, '') || ' ' || coalesce(c.reference_answer, '') as given
      from public.tasks t
      left join public.task_rubric_config c on c.id = t.rubric_config_id
     where t.id = _task_id
  )
  select jsonb_build_object(
    'score', coalesce((
      select max(similarity(s.code, _answer))
        from public.task_submissions s
        join public.tasks t2 on t2.id = s.task_id
       where s.student_id <> _student_id
         and s.status in ('passed', 'needs_review')
         and s.rubric_config_id = q.rubric_config_id
         and md5(coalesce(t2.title, '') || '|' || coalesce(t2.description, '')) = q.question), 0),
    'prompt_overlap', word_similarity(_answer, q.given),
    'answer_words', coalesce(array_length(regexp_split_to_array(btrim(_answer), '\s+'), 1), 0))
  from q;
$$;
revoke all on function public.similar_written_answer(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.similar_written_answer(uuid, uuid, text) to service_role;

create or replace function public.notify_review_outcome(_submission_id uuid, _outcome text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub record;
  title text;
begin
  select s.id, s.task_id, s.student_id, coalesce(t.title, 'your task') as task_title, p.user_id
    into sub
    from public.task_submissions s
    join public.tasks t on t.id = s.task_id
    join public.student_profiles p on p.id = s.student_id
   where s.id = _submission_id;
  if sub.id is null or sub.user_id is null then return; end if;
  title := case _outcome
             when 'passed' then 'Your answer was confirmed'
             when 'already_passed' then 'Your answer check is closed'
             else 'Your answer was checked' end;
  insert into public.notifications (user_id, type, title, message, link, source, audience, dedupe_key)
  values (sub.user_id, 'review_outcome', title,
          case _outcome
            when 'passed' then 'Your answer to "' || sub.task_title || '" passed after a closer look.'
            when 'already_passed' then 'You already passed "' || sub.task_title || '" with a later answer, so nothing more is needed.'
            else 'Your answer to "' || sub.task_title || '" did not pass this time. Read the feedback and try again.' end,
          '/student/dashboard?tab=log', 'reviews', 'student', 'review_outcome:' || sub.id)
  on conflict (user_id, type, dedupe_key) where dedupe_key is not null do nothing;
end
$$;
revoke all on function public.notify_review_outcome(uuid, text) from public, anon, authenticated;

create or replace function public.review_task_submission(_submission_id uuid, _approve boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  sub   record;
  t     record;
  n     integer;
  xp    integer := 0;
  prev  text;
  topic text;
  may_review boolean;
begin
  -- 104: the row is locked, so two reviewers acting at once resolve it exactly once.
  select * into sub from public.task_submissions where id = _submission_id for update;

  -- Who may review is decided before anything about the submission is said. A missing submission
  -- has no owning college, so only an admin can learn that it does not exist.
  select coalesce(public.is_admin(), false)
      or exists (
           select 1 from public.student_profiles sp
             join public.colleges c on c.id = sp.college_id
            where sp.id = sub.student_id
              and c.user_id = (select auth.uid())
              and c.verification_status = 'approved')
    into may_review;
  if not coalesce(may_review, false) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if sub.id is null then return jsonb_build_object('ok', false, 'reason', 'no such submission'); end if;
  if sub.status <> 'needs_review' then
    return jsonb_build_object('ok', false, 'reason', 'not awaiting review');
  end if;

  -- 104: a later attempt already passed this task (a student may resubmit while one waits), so the
  -- one-pass rule makes approval impossible and the review is moot. Close it without a second pass/XP.
  if _approve and exists (select 1 from public.task_submissions x
                           where x.task_id = sub.task_id and x.student_id = sub.student_id
                             and x.status = 'passed' and x.id <> sub.id) then
    update public.task_submissions set status = 'failed' where id = _submission_id;
    perform public.notify_review_outcome(_submission_id, 'already_passed');
    return jsonb_build_object('ok', true, 'status', 'already_completed', 'xp_awarded', 0);
  end if;

  if not _approve then
    update public.task_submissions set status = 'failed' where id = _submission_id;
    perform public.notify_review_outcome(_submission_id, 'not_passed');
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;

  select id, student_id, xp_reward, source, level_id into t from public.tasks where id = sub.task_id;
  if t.level_id is not null then
    select skill into topic from public.levels where id = t.level_id;
  end if;

  update public.task_submissions set status = 'passed' where id = _submission_id;

  prev := current_setting('app.system_write', true);
  perform set_config('app.system_write', 'on', true);

  if t.student_id = sub.student_id then
    update public.tasks set status = 'completed', completed_at = now() where id = t.id;
  else
    update public.task_assignments
       set status = 'completed', completed_at = now(), submitted_at = now()
     where task_id = t.id and student_id = sub.student_id;
  end if;

  if coalesce(t.xp_reward, 0) > 0 then
    insert into public.xp_logs (student_id, xp_points, source)
    values (sub.student_id, t.xp_reward, 'task:' || t.id)
    on conflict (student_id, source) where source like 'task:%' do nothing;
    get diagnostics n = row_count;
    if n > 0 then
      update public.student_profiles set total_xp = coalesce(total_xp, 0) + t.xp_reward
       where id = sub.student_id;
      xp := t.xp_reward;
      update public.task_submissions set xp_awarded = xp where id = _submission_id;
    end if;
  end if;

  perform set_config('app.system_write', coalesce(prev, ''), true);

  perform public.log_activity(sub.student_id, 'task_completed', 'task_submissions', sub.id,
                              jsonb_build_object('task_id', t.id, 'kind', 'rubric', 'reviewed', true));
  perform public.record_activity(sub.student_id, 'task_completed');

  if t.source = 'daily_lot' then
    perform public.record_activity(sub.student_id, 'lot_submitted');
    if topic is not null then
      perform public.record_topic_attempt(sub.student_id, topic, 'correct', t.level_id, null);
    end if;
  end if;

  perform public.notify_review_outcome(_submission_id, 'passed');
  return jsonb_build_object('ok', true, 'status', 'passed', 'xp_awarded', xp);
end $function$;

revoke all on function public.review_task_submission(uuid, boolean) from public, anon;
grant execute on function public.review_task_submission(uuid, boolean) to authenticated, service_role;

create or replace function public.notify_pending_reviews()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  today text := to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD');
  pending integer;
  admins integer := 0;
  colleges integer := 0;
begin
  select count(*) into pending from public.task_submissions where status = 'needs_review';
  if pending = 0 then
    return jsonb_build_object('pending', 0, 'admins', 0, 'colleges', 0);
  end if;

  insert into public.notifications (user_id, type, title, message, link, source, audience, dedupe_key)
  select ur.user_id, 'review_digest', 'Answers waiting for review',
         pending || case when pending = 1 then ' answer is' else ' answers are' end || ' waiting in Work > Flags & reviews.',
         '/admin/dashboard?tab=reviewed-submissions', 'reviews', 'admin', 'review_digest:' || today
    from public.user_roles ur
   where ur.role = 'admin'
  on conflict (user_id, type, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics admins = row_count;

  insert into public.notifications (user_id, type, title, message, link, source, audience, dedupe_key)
  select c.user_id, 'review_digest', 'Answers waiting for review',
         x.n || case when x.n = 1 then ' answer from your students is' else ' answers from your students are' end
             || ' waiting. Open Students > Flagged Submissions.',
         '/college/dashboard?tab=students', 'reviews', 'college', 'review_digest:' || today
    from (select p.college_id, count(*)::integer as n
            from public.task_submissions s
            join public.student_profiles p on p.id = s.student_id
           where s.status = 'needs_review' and p.college_id is not null
           group by p.college_id) x
    join public.colleges c on c.id = x.college_id
   where c.user_id is not null and c.verification_status = 'approved' and c.status = 'active'
  on conflict (user_id, type, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics colleges = row_count;

  return jsonb_build_object('pending', pending, 'admins', admins, 'colleges', colleges);
end
$$;
revoke all on function public.notify_pending_reviews() from public, anon, authenticated;
grant execute on function public.notify_pending_reviews() to service_role;

do $$
declare
  def text := pg_get_functiondef('public.review_task_submission(uuid, boolean)'::regprocedure);
begin
  if position('for update' in def) = 0 or position('notify_review_outcome' in def) = 0 then
    raise exception '104: review_task_submission edits missing';
  end if;
  if has_function_privilege('anon', 'public.review_task_submission(uuid, boolean)', 'execute') or not has_function_privilege('authenticated', 'public.review_task_submission(uuid, boolean)', 'execute') then
    raise exception '104: review_task_submission grants wrong';
  end if;
  if has_function_privilege('authenticated', 'public.similar_written_answer(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.notify_pending_reviews()', 'execute')
     or has_function_privilege('authenticated', 'public.notify_review_outcome(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.notify_review_outcome(uuid, text)', 'execute') then
    raise exception '104: a server-only function is callable by a browser role';
  end if;
  if not has_function_privilege('service_role', 'public.similar_written_answer(uuid, uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.notify_pending_reviews()', 'execute') then
    raise exception '104: service_role cannot run the new functions';
  end if;
  if to_regclass('public.notifications_user_type_dedupe_key_uniq') is null then
    raise exception '104: needs migration 40''s notifications dedupe index';
  end if;
  if position('-- 103: a task its own student inserted is never evidence.' in pg_get_functiondef(
       'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure)) = 0 then
    raise exception '104: requires migration 103';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
