-- stage70: hybrid rubric grading for written tasks (business/pitch Lots,
-- Writing/Research/Analysis assigned tasks, hr-behavioral/verbal-ability
-- level proofs).
--
-- Extends stage69's record_task_submission() rather than adding a second
-- completion function, so XP/activity logic for sandbox and rubric tasks
-- never has to be kept in sync across two places. A task uses at most one
-- grading mode: sandbox_config_id, rubric_config_id, or neither (proof).

begin;

-- ---------------------------------------------------------------------------
-- 1. Rubric config
-- ---------------------------------------------------------------------------

create table public.task_rubric_config (
  id uuid primary key default gen_random_uuid(),
  prompt_text text not null,
  -- [{"id","name","description","max_points"}], 2-8 criteria.
  criteria jsonb not null
    check (jsonb_typeof(criteria) = 'array' and jsonb_array_length(criteria) between 2 and 8),
  min_words integer not null default 150 check (min_words >= 20),
  max_words integer not null default 800 check (max_words <= 3000),
  pass_threshold integer not null default 70 check (pass_threshold between 1 and 100),
  -- Must score >= 90 on a dry run before a config goes live on a real task.
  reference_answer text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.task_rubric_config enable row level security;
create policy task_rubric_config_admin_all on public.task_rubric_config
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

comment on table public.task_rubric_config is
  'Rubric criteria and reference answer for a written task, graded by AI in submit-written-task. Admin-only.';

-- ---------------------------------------------------------------------------
-- 2. Mark a task or Lot template as rubric-graded; enforce one grading mode
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists rubric_config_id uuid references public.task_rubric_config(id) on delete set null;

alter table public.tasks
  add constraint tasks_one_grading_mode
  check (num_nonnulls(sandbox_config_id, rubric_config_id) <= 1);

alter table public.lot_templates
  add column if not exists rubric_config_id uuid references public.task_rubric_config(id) on delete set null;

-- The stage69 clamp and protect_tasks guard both need to know about the new
-- column, or a student could insert/switch onto a rubric config the same way
-- they could onto a sandbox one before this.
create or replace function public.tasks_clamp_student_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.xp := 0;
    new.xp_reward := 0;
    new.suggested_xp := null;
    new.approved_by_admin := false;
    new.status := coalesce(new.status, 'pending');
    new.sandbox_config_id := null;
    new.rubric_config_id := null;
  end if;
  return new;
end
$$;

drop trigger if exists protect_tasks on public.tasks;
create trigger protect_tasks
  before update on public.tasks
  for each row execute function public.protect_columns(
    'xp', 'xp_reward', 'suggested_xp', 'approved_by_admin', 'status',
    'sandbox_config_id', 'rubric_config_id');

-- A rubric (written) task is also graded automatically — no proof upload.
create or replace function public.proof_uploads_reject_sandbox()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.tasks
     where id = new.task_id
       and (sandbox_config_id is not null or rubric_config_id is not null)
  ) then
    raise exception 'This task is graded automatically. Submit it in the task screen instead of uploading a proof.'
      using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Extend task_submissions for rubric attempts
-- ---------------------------------------------------------------------------

alter table public.task_submissions
  alter column sandbox_config_id drop not null,
  alter column language drop not null,
  add column if not exists rubric_config_id uuid references public.task_rubric_config(id),
  -- [{"criterion_id","points","evidence"}]
  add column if not exists rubric_scores jsonb,
  add column if not exists flags text[] not null default '{}';

alter table public.task_submissions
  add constraint task_submissions_one_config
  check (num_nonnulls(sandbox_config_id, rubric_config_id) = 1);

-- needs_review: any flag (similarity, grader disagreement, AI-authorship
-- risk) routes here instead of auto pass/fail. No XP, no activity — a human
-- decides via the review screen, which then re-runs the pass branch.
alter table public.task_submissions drop constraint if exists task_submissions_status_check;
alter table public.task_submissions
  add constraint task_submissions_status_check check (status in ('passed', 'failed', 'needs_review'));

-- pg_trgm is already installed (confirmed live). Used for the similarity
-- pre-check in submit-written-task: a written answer close to the reference
-- answer or to another student's passed/pending answer gets flagged.
create index if not exists task_submissions_text_trgm
  on public.task_submissions using gin (code gin_trgm_ops)
  where rubric_config_id is not null;

comment on column public.task_submissions.code is
  'The student''s code (sandbox tasks) or written answer text (rubric tasks). Same column, since a submission is exactly one or the other.';

-- ---------------------------------------------------------------------------
-- 4. Extend record_task_submission() to grade rubric submissions too
-- ---------------------------------------------------------------------------

drop function if exists public.record_task_submission(uuid, uuid, uuid, text, text, integer, integer, integer, jsonb, text, integer);

create function public.record_task_submission(
  _student_id uuid,
  _task_id uuid,
  _sandbox_config_id uuid,
  _language text,
  _code text,
  _passed_count integer,
  _total_count integer,
  _score integer,
  _details jsonb,
  _runner text,
  _duration_ms integer,
  _rubric_config_id uuid default null,
  _rubric_scores jsonb default null,
  _flags text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pass_threshold integer;
  t        record;
  sub_id   uuid;
  status   text;
  n        integer;
  xp       integer := 0;
  prev     text;
  topic    text;
begin
  if _sandbox_config_id is not null then
    select task_sandbox_config.pass_threshold into pass_threshold
      from public.task_sandbox_config where id = _sandbox_config_id;
  elsif _rubric_config_id is not null then
    select task_rubric_config.pass_threshold into pass_threshold
      from public.task_rubric_config where id = _rubric_config_id;
  end if;

  select id, student_id, xp_reward, source, level_id into t from public.tasks where id = _task_id;
  if pass_threshold is null or t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'task or config missing');
  end if;

  -- Any flag (similarity, grader disagreement, AI-authorship risk) routes to
  -- a human, whatever the score says. Sandbox submissions never carry flags.
  if coalesce(array_length(_flags, 1), 0) > 0 then
    status := 'needs_review';
  elsif _score >= pass_threshold then
    status := 'passed';
  else
    status := 'failed';
  end if;

  insert into public.task_submissions
    (task_id, student_id, sandbox_config_id, rubric_config_id, language, code, sandbox_score,
     passed_count, total_count, status, details, runner, duration_ms, rubric_scores, flags)
  values
    (_task_id, _student_id, _sandbox_config_id, _rubric_config_id, _language, _code, _score,
     _passed_count, _total_count, status, coalesce(_details, '[]'::jsonb), _runner, _duration_ms,
     _rubric_scores, coalesce(_flags, '{}'))
  on conflict (task_id, student_id) where status = 'passed' do nothing
  returning id into sub_id;

  if sub_id is null then
    -- Either a second passing submit (double click), or - for rubric - a
    -- resubmit while an earlier attempt is still needs_review/failed. The
    -- unique index only fires on a second PASS, so this branch only means
    -- "already passed".
    return jsonb_build_object('ok', true, 'status', 'passed', 'already_completed', true, 'xp_awarded', 0);
  end if;

  if t.level_id is not null then
    select skill into topic from public.levels where id = t.level_id;
  end if;

  if status = 'passed' then
    prev := current_setting('app.system_write', true);
    perform set_config('app.system_write', 'on', true);

    if t.student_id = _student_id then
      update public.tasks set status = 'completed', completed_at = now() where id = _task_id;
    else
      update public.task_assignments
         set status = 'completed', completed_at = now(), submitted_at = now()
       where task_id = _task_id and student_id = _student_id;
    end if;

    if coalesce(t.xp_reward, 0) > 0 then
      insert into public.xp_logs (student_id, xp_points, source)
      values (_student_id, t.xp_reward, 'task:' || _task_id)
      on conflict (student_id, source) where source like 'task:%' do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        update public.student_profiles set total_xp = coalesce(total_xp, 0) + t.xp_reward
         where id = _student_id;
        xp := t.xp_reward;
        update public.task_submissions set xp_awarded = xp where id = sub_id;
      end if;
    end if;

    perform set_config('app.system_write', coalesce(prev, ''), true);

    perform public.log_activity(_student_id, 'task_completed', 'task_submissions', sub_id,
                                jsonb_build_object('task_id', _task_id, 'score', _score,
                                                   'kind', case when _rubric_config_id is not null then 'rubric' else 'sandbox' end));
    perform public.record_activity(_student_id, 'task_completed');

    if t.source = 'daily_lot' then
      perform public.record_activity(_student_id, 'lot_submitted');
      if topic is not null then
        perform public.record_topic_attempt(_student_id, topic, 'correct', t.level_id, null);
      end if;
    end if;

  elsif status = 'failed' and t.source = 'daily_lot' and topic is not null
        and not exists (select 1 from public.task_submissions
                         where task_id = _task_id and student_id = _student_id and id <> sub_id) then
    -- Only the first failed attempt moves the rating (needs_review is not a
    -- failure judgement, so it never touches the rating).
    perform public.record_topic_attempt(_student_id, topic, 'incorrect', t.level_id, null);
  end if;

  return jsonb_build_object('ok', true, 'submission_id', sub_id, 'status', status,
                            'already_completed', false, 'xp_awarded', xp);
end
$$;

revoke all on function public.record_task_submission(
  uuid, uuid, uuid, text, text, integer, integer, integer, jsonb, text, integer, uuid, jsonb, text[])
  from public, anon, authenticated;
grant execute on function public.record_task_submission(
  uuid, uuid, uuid, text, text, integer, integer, integer, jsonb, text, integer, uuid, jsonb, text[])
  to service_role;

comment on function public.record_task_submission(
  uuid, uuid, uuid, text, text, integer, integer, integer, jsonb, text, integer, uuid, jsonb, text[]) is
  'The one completion path for both sandbox (stage69) and rubric (stage70) auto-graded tasks. A flagged rubric submission is stored as needs_review with no XP or activity until a human approves it via approve_reviewed_submission().';

-- ---------------------------------------------------------------------------
-- 5. Human review of a flagged (needs_review) submission
-- ---------------------------------------------------------------------------

-- Approve: replays the same completion effects record_task_submission()
-- would have run on a clean pass. Reject: marks it failed, no effects.
-- Callable by an admin, or a college_admin who owns the student's college
-- (mirrors mayActOnStudentWork's scoping in _shared/authz.ts).
create or replace function public.review_task_submission(_submission_id uuid, _approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub   record;
  t     record;
  n     integer;
  xp    integer := 0;
  prev  text;
  topic text;
  may_review boolean;
begin
  select * into sub from public.task_submissions where id = _submission_id;
  if sub.id is null then return jsonb_build_object('ok', false, 'reason', 'no such submission'); end if;
  if sub.status <> 'needs_review' then
    return jsonb_build_object('ok', false, 'reason', 'not awaiting review');
  end if;

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

  if not _approve then
    update public.task_submissions set status = 'failed' where id = _submission_id;
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

  return jsonb_build_object('ok', true, 'status', 'passed', 'xp_awarded', xp);
end
$$;

revoke all on function public.review_task_submission(uuid, boolean) from public, anon;
grant execute on function public.review_task_submission(uuid, boolean) to authenticated;

comment on function public.review_task_submission(uuid, boolean) is
  'Admin or the student''s own (approved) college_admin resolves a needs_review submission. Approve replays record_task_submission''s pass effects; reject marks it failed. Scoping mirrors mayActOnStudentWork in _shared/authz.ts.';

-- List for the review screen: needs_review submissions the caller may act on.
create or replace function public.needs_review_submissions()
returns table(
  submission_id uuid, task_id uuid, task_title text, student_id uuid, student_name text,
  score integer, flags text[], rubric_scores jsonb, code text, created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.task_id, t.title, s.student_id, p.full_name,
         s.sandbox_score, s.flags, s.rubric_scores, s.code, s.created_at
    from public.task_submissions s
    join public.tasks t on t.id = s.task_id
    join public.student_profiles p on p.id = s.student_id
   where s.status = 'needs_review'
     and (
       coalesce(public.is_admin(), false)
       or exists (
            select 1 from public.colleges c
             where c.id = p.college_id
               and c.user_id = (select auth.uid())
               and c.verification_status = 'approved')
     )
   order by s.created_at asc;
$$;

revoke all on function public.needs_review_submissions() from public, anon;
grant execute on function public.needs_review_submissions() to authenticated;

commit;
