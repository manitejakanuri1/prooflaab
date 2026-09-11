-- stage69: sandbox-graded coding tasks.
--
-- A coding task can now be auto-graded by running the student's code against
-- test cases, instead of going through proof_uploads + verify-proof. This
-- migration is purely additive: no existing task has sandbox_config_id set
-- until a college/admin links one, so nothing changes for any task until
-- that happens.
--
-- record_task_submission() is written as the ONE completion path for every
-- auto-graded task, sandbox or rubric — stage70 (rubric tasks) extends this
-- same function rather than adding a second one, so XP/activity logic never
-- has to be kept in sync across two places.

begin;

-- ---------------------------------------------------------------------------
-- 1. Config and submissions tables
-- ---------------------------------------------------------------------------

create table public.task_sandbox_config (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'stdio' check (kind in ('stdio')),
  language text not null check (language in ('python','javascript','java','cpp','c','go','ruby','php')),
  starter_code text not null default '',
  constraints_text text,
  -- Array of {"id","stdin","expected_output","visible","weight"}. Capped at 10
  -- so a submit never runs more than 10 sequential test-runner calls.
  test_cases jsonb not null
    check (jsonb_typeof(test_cases) = 'array' and jsonb_array_length(test_cases) between 1 and 10),
  -- Must score 100 via run-sandbox's admin reference check before a config
  -- goes live on a real task.
  reference_solution text not null,
  time_limit_ms integer not null default 5000 check (time_limit_ms between 500 and 20000),
  memory_limit_mb integer not null default 256 check (memory_limit_mb between 32 and 1024),
  pass_threshold integer not null default 80 check (pass_threshold between 1 and 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.task_sandbox_config enable row level security;
create policy task_sandbox_config_admin_all on public.task_sandbox_config
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

comment on table public.task_sandbox_config is
  'Hidden tests and reference solution for a coding task. Admin-only: students never read this table directly, only through sandbox_task_view().';

create table public.task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  sandbox_config_id uuid references public.task_sandbox_config(id),
  language text,
  -- The student's submitted code (sandbox) or written answer (stage70 rubric).
  code text not null check (length(code) <= 20000),
  sandbox_score integer not null check (sandbox_score between 0 and 100),
  passed_count integer not null default 0,
  total_count integer not null default 0,
  status text not null check (status in ('passed','failed')),
  -- Per-test verdicts, hidden tests redacted before this is ever written.
  details jsonb not null default '[]'::jsonb,
  runner text,
  duration_ms integer,
  xp_awarded integer not null default 0,
  created_at timestamptz not null default now()
);

-- One completed pass per student per task.
create unique index task_submissions_one_pass
  on public.task_submissions (task_id, student_id)
  where status = 'passed';

create index task_submissions_student_task
  on public.task_submissions (student_id, task_id, created_at desc);
create index task_submissions_task
  on public.task_submissions (task_id);

alter table public.task_submissions enable row level security;
create policy task_submissions_read on public.task_submissions
  for select to authenticated
  using (student_id = (select auth.uid()) or (select public.is_admin()));
-- Deliberately no insert/update/delete policy: only the service role (the
-- submit-sandbox-task and submit-written-task edge functions) writes here.

comment on table public.task_submissions is
  'One row per graded attempt. Written only by service-role edge functions via record_task_submission(); students read their own rows, admins read all.';

-- ---------------------------------------------------------------------------
-- 2. Mark a task or Lot template as sandbox-graded
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists sandbox_config_id uuid references public.task_sandbox_config(id) on delete set null,
  add column if not exists is_sandbox_task boolean generated always as (sandbox_config_id is not null) stored;

create index if not exists tasks_sandbox_config
  on public.tasks (sandbox_config_id) where sandbox_config_id is not null;

alter table public.lot_templates
  add column if not exists sandbox_config_id uuid references public.task_sandbox_config(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. Anti-cheat: a student cannot set their own grading mode or XP
-- ---------------------------------------------------------------------------

-- A direct browser insert into tasks runs as role "authenticated". A
-- security-definer function (create_lot_for) or an edge function using the
-- service key is untouched by this — it checks current_user, not the JWT.
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
  end if;
  return new;
end
$$;

comment on function public.tasks_clamp_student_insert() is
  'Blocks a student from inserting a task with their own XP or config link. Without this, once XP auto-pays on verification (on_proof_reviewed / record_task_submission), any student could insert a high-XP task pointed at an easy sandbox config and farm it — tasks_own_insert''s WITH CHECK only restricts student_id, not xp_reward.';

drop trigger if exists tasks_clamp_student_insert on public.tasks;
create trigger tasks_clamp_student_insert
  before insert on public.tasks
  for each row execute function public.tasks_clamp_student_insert();

-- protect_tasks now also guards sandbox_config_id, so a student cannot
-- switch their own task onto a different (easier) config after creation.
drop trigger if exists protect_tasks on public.tasks;
create trigger protect_tasks
  before update on public.tasks
  for each row execute function public.protect_columns(
    'xp', 'xp_reward', 'suggested_xp', 'approved_by_admin', 'status', 'sandbox_config_id');

-- Coding tasks are graded automatically. A proof upload against one would be
-- ignored forever (verify-proof also refuses it), so it is rejected up front
-- with a message that tells the student what to do instead.
create or replace function public.proof_uploads_reject_sandbox()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.tasks where id = new.task_id and sandbox_config_id is not null) then
    raise exception 'This is a coding task. Submit your code in the editor instead of uploading a proof.'
      using errcode = 'P0001';
  end if;
  return new;
end
$$;

drop trigger if exists proof_uploads_reject_sandbox on public.proof_uploads;
create trigger proof_uploads_reject_sandbox
  before insert on public.proof_uploads
  for each row execute function public.proof_uploads_reject_sandbox();

-- ---------------------------------------------------------------------------
-- 4. What a student may read about a coding task (hidden tests never leave)
-- ---------------------------------------------------------------------------

create or replace function public.sandbox_task_view(_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'task_id', t.id,
    'title', t.title,
    'description', t.description,
    'language', c.language,
    'starter_code', c.starter_code,
    'constraints', c.constraints_text,
    'pass_threshold', c.pass_threshold,
    'time_limit_ms', c.time_limit_ms,
    'visible_tests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', tc->>'id', 'stdin', tc->>'stdin', 'expected_output', tc->>'expected_output'))
        from jsonb_array_elements(c.test_cases) tc
       where coalesce((tc->>'visible')::boolean, false)), '[]'::jsonb),
    'hidden_test_count', (
      select count(*) from jsonb_array_elements(c.test_cases) tc
       where not coalesce((tc->>'visible')::boolean, false)),
    'completed', exists (
      select 1 from public.task_submissions s
       where s.task_id = t.id and s.student_id = auth.uid() and s.status = 'passed'),
    'attempts', (
      select count(*) from public.task_submissions s
       where s.task_id = t.id and s.student_id = auth.uid())
  )
  from public.tasks t
  join public.task_sandbox_config c on c.id = t.sandbox_config_id
  where t.id = _task_id
    and (t.student_id = auth.uid()
         or exists (select 1 from public.task_assignments a
                     where a.task_id = t.id and a.student_id = auth.uid()));
$$;

revoke all on function public.sandbox_task_view(uuid) from public, anon;
grant execute on function public.sandbox_task_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The one completion path for every auto-graded task
-- ---------------------------------------------------------------------------

-- service_role only: the edge functions call this with the graded result
-- already computed. It is the single place that marks a task complete, pays
-- XP once, and logs activity — stage70 extends this same function for rubric
-- submissions rather than duplicating the XP/activity logic.
create or replace function public.record_task_submission(
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
  _duration_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg      record;
  t        record;
  sub_id   uuid;
  is_pass  boolean;
  n        integer;
  xp       integer := 0;
  prev     text;
  topic    text;
begin
  select id, pass_threshold into cfg from public.task_sandbox_config where id = _sandbox_config_id;
  select id, student_id, xp_reward, source, level_id into t from public.tasks where id = _task_id;
  if cfg.id is null or t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'task or config missing');
  end if;

  is_pass := _score >= cfg.pass_threshold;

  insert into public.task_submissions
    (task_id, student_id, sandbox_config_id, language, code, sandbox_score,
     passed_count, total_count, status, details, runner, duration_ms)
  values
    (_task_id, _student_id, _sandbox_config_id, _language, _code, _score,
     _passed_count, _total_count, case when is_pass then 'passed' else 'failed' end,
     coalesce(_details, '[]'::jsonb), _runner, _duration_ms)
  on conflict (task_id, student_id) where status = 'passed' do nothing
  returning id into sub_id;

  -- A second passing submit (double click, two tabs) hits the unique index
  -- and inserts nothing. Report that plainly rather than as an error.
  if sub_id is null then
    return jsonb_build_object('ok', true, 'passed', true, 'already_completed', true, 'xp_awarded', 0);
  end if;

  if t.level_id is not null then
    select skill into topic from public.levels where id = t.level_id;
  end if;

  if is_pass then
    prev := current_setting('app.system_write', true);
    perform set_config('app.system_write', 'on', true);

    -- A personal task (Lot, level proof) completes the task row itself; a
    -- task assigned to several students (college/admin) completes the
    -- assignment row instead.
    if t.student_id = _student_id then
      update public.tasks set status = 'completed', completed_at = now() where id = _task_id;
    else
      update public.task_assignments
         set status = 'completed', completed_at = now(), submitted_at = now()
       where task_id = _task_id and student_id = _student_id;
    end if;

    -- XP once per task, through the same index stage68 added for proof XP.
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

    -- task_completed: the squad metric and quest metric for auto-graded work.
    perform public.log_activity(_student_id, 'task_completed', 'task_submissions', sub_id,
                                jsonb_build_object('task_id', _task_id, 'score', _score, 'kind', 'sandbox'));
    perform public.record_activity(_student_id, 'task_completed');

    if t.source = 'daily_lot' then
      -- A Lot pass never clears a level (Lots never touch student_levels),
      -- but it does count toward the daily-lot quest and moves the topic
      -- rating the same way a Lot proof verification does.
      perform public.record_activity(_student_id, 'lot_submitted');
      if topic is not null then
        perform public.record_topic_attempt(_student_id, topic, 'correct', t.level_id, null);
      end if;
    end if;

  elsif t.source = 'daily_lot' and topic is not null
        and not exists (select 1 from public.task_submissions
                         where task_id = _task_id and student_id = _student_id and id <> sub_id) then
    -- Only the FIRST failed attempt moves the rating, so spamming wrong
    -- submits on the same Lot cannot crater a topic's rating.
    perform public.record_topic_attempt(_student_id, topic, 'incorrect', t.level_id, null);
  end if;

  return jsonb_build_object('ok', true, 'submission_id', sub_id, 'passed', is_pass,
                            'already_completed', false, 'xp_awarded', xp);
end
$$;

revoke all on function public.record_task_submission(uuid, uuid, uuid, text, text, integer, integer, integer, jsonb, text, integer)
  from public, anon, authenticated;
grant execute on function public.record_task_submission(uuid, uuid, uuid, text, text, integer, integer, integer, jsonb, text, integer)
  to service_role;

comment on function public.record_task_submission(uuid, uuid, uuid, text, text, integer, integer, integer, jsonb, text, integer) is
  'The one completion path for sandbox-graded tasks: inserts the submission, completes the task/assignment, pays XP once (xp_logs_one_award_per_task), logs task_completed, and for Lots also logs lot_submitted and updates topic_ratings. stage70 extends this for rubric-graded (written) tasks.';

-- ---------------------------------------------------------------------------
-- 6. Squad points and a quest for auto-graded task completion
-- ---------------------------------------------------------------------------

insert into public.squad_scoring_rules (college_id, metric, label, points, description)
select null, 'task_completed', 'Auto-graded task passed', 25,
       'A sandbox or rubric task passed its automatic grading'
 where not exists (
   select 1 from public.squad_scoring_rules where college_id is null and metric = 'task_completed');

insert into public.quests (slug, name, description, cadence, metric, target, xp_reward, is_active)
select 'weekly-task', 'Pass an auto-graded task', 'Pass one auto-graded task this week',
       'weekly', 'task_completed', 1, 80, true
 where not exists (select 1 from public.quests where slug = 'weekly-task');

-- ---------------------------------------------------------------------------
-- 7. Badges and recruiter/TPO views count passed submissions as real work
-- ---------------------------------------------------------------------------

create or replace function public.record_activity(_student_id uuid, _metric text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q record; b record; period date;
  have integer; topics integer; proofs integer; streak integer;
begin
  if _student_id is null then return; end if;

  perform set_config('app.system_write', 'on', true);

  perform public.touch_streak(_student_id);

  for q in select * from public.quests where is_active and metric = _metric loop
    period := case when q.cadence = 'daily'
                   then current_date
                   else date_trunc('week', current_date)::date end;

    insert into public.student_quests (student_id, quest_slug, period_start, progress)
    values (_student_id, q.slug, period, 1)
    on conflict (student_id, quest_slug, period_start) do update
      set progress = least(public.student_quests.progress + 1, q.target);

    update public.student_quests sq
       set completed_at = now()
     where sq.student_id = _student_id and sq.quest_slug = q.slug
       and sq.period_start = period and sq.progress >= q.target
       and sq.completed_at is null;

    if found then
      insert into public.xp_logs (student_id, xp_points, source)
      values (_student_id, q.xp_reward, 'quest:' || q.slug);
      update public.student_profiles set total_xp = total_xp + q.xp_reward
       where id = _student_id;
    end if;
  end loop;

  select count(*) into topics from public.student_levels
   where student_id = _student_id and status in ('cleared', 'mastered');
  -- CHANGED (stage69): a badge counting "proofs" now also counts passed
  -- auto-graded submissions, so a student who only ever does sandbox Lots
  -- still earns the proof-count badges.
  select (select count(*) from public.proof_uploads
           where student_id = _student_id and status = 'Verified')
       + (select count(*) from public.task_submissions
           where student_id = _student_id and status = 'passed')
    into proofs;
  select coalesce(current_days, 0) into streak from public.student_streaks
   where student_id = _student_id;

  for b in select * from public.badges loop
    have := case b.rule_kind
              when 'level'  then topics
              when 'proof'  then proofs
              when 'streak' then streak
              else 0 end;
    if b.rule_value is not null and have >= b.rule_value then
      insert into public.student_badges (student_id, badge_slug)
      values (_student_id, b.slug)
      on conflict (student_id, badge_slug) do nothing;
    end if;
  end loop;

  perform set_config('app.system_write', 'off', true);
end
$$;

-- recruiter_talent: a passed auto-graded task counts as verified work
-- alongside a verified proof upload.
create or replace function public.recruiter_talent(
  _role text default null, _skills text[] default null, _branch text default null,
  _min_skill integer default null, _min_comms integer default null,
  _active_within integer default null, _limit integer default 50, _offset integer default 0
)
returns table(
  student_id uuid, full_name text, branch text, batch text, target_role text,
  total_xp integer, trust_score numeric, skills_proven bigint, skills_total bigint,
  top_skills text[], lots_done bigint, proofs_verified bigint, comms_score integer,
  explanations bigint, days_since_active integer, active_weeks bigint,
  squad_name text, squad_rank integer, season_points integer, shortlisted boolean,
  total_matches bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (select public.my_recruiter_id() as rid,
                     public.is_verified_recruiter() as ok),
  candidates as (
    select p.id, p.full_name, p.branch, p.batch, p.target_role,
           p.total_xp, p.trust_score, p.last_active
      from public.student_profiles p
     where (select ok from me)
       and public.student_is_discoverable(p.id)
       and (_branch is null or lower(p.branch) = lower(_branch))
       and (_role   is null or p.target_role ilike '%' || _role || '%')
       and (_active_within is null
            or (p.last_active is not null
                and p.last_active >= now() - make_interval(days => _active_within)))
  ),
  enriched as (
    select c.*,
           (select count(*) from public.student_skills s
             where s.student_id = c.id and s.status = 'proven') as skills_proven,
           (select count(*) from public.student_skills s
             where s.student_id = c.id) as skills_total,
           (select coalesce(array_agg(s.skill order by
                      array_position(array['proven','assessed','claimed'], s.status), s.skill),
                    '{}')
              from public.student_skills s where s.student_id = c.id) as top_skills,
           (select max(s.assessed_score) from public.student_skills s
             where s.student_id = c.id) as best_skill_score,
           (select count(*) from public.tasks t
             where t.student_id = c.id and t.status in ('Completed','completed')) as lots_done,
           -- CHANGED (stage69): verified proofs + passed auto-graded submissions.
           (select count(*) from public.proof_uploads pu
             where pu.student_id = c.id and pu.status in ('Verified','verified'))
           + (select count(*) from public.task_submissions ts
             where ts.student_id = c.id and ts.status = 'passed') as proofs_verified,
           (select round(avg(v.communication_score))::integer from public.voice_explanations v
             where v.student_id = c.id and v.communication_score is not null) as comms_score,
           (select count(*) from public.voice_explanations v
             where v.student_id = c.id) as explanations,
           (select count(distinct w.week) from public.student_weekly_scores w
             where w.student_id = c.id and w.points > 0) as active_weeks,
           (select q.name from public.squad_members m
              join public.squads q on q.id = m.squad_id
             where m.student_id = c.id and m.left_at is null limit 1) as squad_name,
           (select q.rank from public.squad_members m
              join public.squads q on q.id = m.squad_id
             where m.student_id = c.id and m.left_at is null limit 1) as squad_rank,
           (select q.points from public.squad_members m
              join public.squads q on q.id = m.squad_id
             where m.student_id = c.id and m.left_at is null limit 1) as season_points,
           exists (select 1 from public.recruiter_shortlists sl
                    where sl.student_id = c.id
                      and sl.recruiter_id = (select rid from me)) as shortlisted
      from candidates c
  ),
  filtered as (
    select * from enriched e
     where (_min_skill is null or coalesce(e.best_skill_score, 0) >= _min_skill)
       and (_min_comms is null or coalesce(e.comms_score, 0)     >= _min_comms)
       and (_skills is null or exists (
              select 1 from public.student_skills s
               where s.student_id = e.id
                 and lower(s.skill) = any (select lower(x) from unnest(_skills) x)))
  )
  select f.id, f.full_name, f.branch, f.batch, f.target_role,
         f.total_xp, f.trust_score,
         f.skills_proven, f.skills_total, f.top_skills,
         f.lots_done, f.proofs_verified,
         f.comms_score, f.explanations,
         case when f.last_active is null then 999
              else (current_date - f.last_active::date) end,
         f.active_weeks,
         f.squad_name, f.squad_rank, f.season_points,
         f.shortlisted,
         count(*) over ()
    from filtered f
   order by f.skills_proven desc, f.proofs_verified desc, f.total_xp desc
   limit greatest(1, least(coalesce(_limit, 50), 100))
  offset greatest(0, coalesce(_offset, 0));
$$;

-- recruiter_home: lots_submitted must also count sandbox/rubric tasks, which
-- never create a proof_uploads row.
create or replace function public.recruiter_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare rid uuid := public.my_recruiter_id(); me record;
begin
  if rid is null then return jsonb_build_object('error', 'not a recruiter'); end if;
  select * into me from public.recruiters where id = rid;

  if not me.verified then
    return jsonb_build_object(
      'verified', false,
      'company', me.company,
      'message', 'Your account is awaiting verification. Candidates appear once ' ||
                 'an administrator has approved you.');
  end if;

  return jsonb_build_object(
    'verified', true,
    'company', me.company,

    'candidates_available', (select count(*) from public.student_profiles p
                              where public.student_is_discoverable(p.id)),

    'new_this_week', (select count(*) from public.student_profiles p
                       where public.student_is_discoverable(p.id)
                         and p.created_at >= now() - interval '7 days'),

    'shortlisted', (select count(*) from public.recruiter_shortlists
                     where recruiter_id = rid),
    'awaiting_response', (select count(*) from public.recruiter_shortlists
                           where recruiter_id = rid and student_response is null),
    'accepted', (select count(*) from public.recruiter_shortlists
                  where recruiter_id = rid and student_response = 'accepted'),

    'lots_open', (select count(*) from public.tasks t
                   where t.sponsored_by = rid and t.status = 'pending'),
    -- CHANGED (stage69): a sponsored sandbox/rubric Lot has no proof_uploads
    -- row, so "submitted" also has to look at task_submissions.
    'lots_submitted', (select count(*) from public.tasks t
                        where t.sponsored_by = rid
                          and (exists (select 1 from public.proof_uploads pu where pu.task_id = t.id)
                               or exists (select 1 from public.task_submissions ts where ts.task_id = t.id))),

    'pipeline', (select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (
        select stage, count(*) as n from public.recruiter_shortlists
         where recruiter_id = rid group by stage) s),

    'recommended', (select coalesce(jsonb_agg(r order by r.skills_proven desc), '[]'::jsonb) from (
        select t.student_id, t.full_name, t.branch, t.target_role,
               t.skills_proven, t.proofs_verified, t.comms_score, t.days_since_active
          from public.recruiter_talent(null, null, null, null, null, 30, 5, 0) t
         where not t.shortlisted) r),

    'recent_views', (select coalesce(jsonb_agg(v order by v.viewed_at desc), '[]'::jsonb) from (
        select rv.student_id, p.full_name, rv.viewed_at
          from public.recruiter_views rv
          join public.student_profiles p on p.id = rv.student_id
         where rv.recruiter_id = rid
         order by rv.viewed_at desc limit 8) v)
  );
end
$$;

-- tpo_student_profile: a count of passed auto-graded work, alongside the
-- proof/task counters already there.
create or replace function public.tpo_student_profile(_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cid uuid := public.my_college_id();
  me  uuid := (select auth.uid());
  p record;
  may_see boolean;
begin
  select * into p from public.student_profiles where id = _student_id;
  if p is null then return jsonb_build_object('error','no such student'); end if;

  may_see :=
       (cid is not null and p.college_id is not null and p.college_id = cid)
    or coalesce(public.is_admin(), false)
    or (me is not null and p.id = me);

  if not coalesce(may_see, false) then
    return jsonb_build_object('error','that student is not at your college');
  end if;

  return jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'roll_number', p.roll_number,
    'branch', p.branch,
    'batch', p.batch,
    'email', (select c.email from public.student_contact c where c.student_id = p.id),
    'phone', (select c.phone from public.student_contact c where c.student_id = p.id),
    'trust_score', p.trust_score,
    'total_xp', p.total_xp,
    'joined_at', p.created_at,
    'last_active', p.last_active,
    'days_quiet', case when p.last_active is null then 999
                       else (current_date - p.last_active::date) end,

    'onboarding', jsonb_build_object(
      'status', p.onboarding_status,
      'profile_completed', p.profile_completed,
      'calibration_completed', p.calibration_completed,
      'first_task_completed', p.first_task_completed,
      'invited_at', p.invited_at,
      'onboarded_at', p.onboarded_at),

    'squad', (select jsonb_build_object(
                'id', q.id, 'name', q.name, 'role', m.membership_type,
                'contribution', m.contribution, 'joined_at', m.joined_at)
                from public.squad_members m
                join public.squads q on q.id = m.squad_id
               where m.student_id = p.id and m.left_at is null limit 1),

    'activity_30d', (select coalesce(jsonb_agg(t order by t.n desc), '[]'::jsonb) from (
        select event_type, count(*) as n
          from public.student_activity_events
         where student_id = p.id and occurred_at >= now() - interval '30 days'
         group by event_type) t),

    'skills', (select coalesce(jsonb_agg(jsonb_build_object(
                 'skill', s.skill, 'status', s.status,
                 'score', s.assessed_score, 'lots', s.proven_lots)
                 order by s.status, s.skill), '[]'::jsonb)
                 from public.student_skills s where s.student_id = p.id),

    'tasks', jsonb_build_object(
      'assigned',  (select count(*) from public.task_assignments where student_id = p.id),
      'completed', (select count(*) from public.task_assignments
                     where student_id = p.id and status = 'completed'),
      -- CHANGED (stage69): passed sandbox/rubric submissions, own Lots and
      -- level proofs included (task_assignments only covers college/admin
      -- assignments).
      'auto_graded_passed', (select count(*) from public.task_submissions
                               where student_id = p.id and status = 'passed')),

    'voice_recordings', (select count(*) from public.voice_explanations where student_id = p.id),

    'recent_work', (select coalesce(jsonb_agg(w order by w.submitted_at desc), '[]'::jsonb) from (
        select pu.id, pu.file_name, pu.status, pu.ai_score,
               pu.admin_review_status, pu.submitted_at,
               (select t.title from public.tasks t where t.id = pu.task_id) as task_title
          from public.proof_uploads pu
         where pu.student_id = p.id
         order by pu.submitted_at desc nulls last limit 5) w),

    'interventions', (select coalesce(jsonb_agg(jsonb_build_object(
                        'type', i.type, 'reason', i.reason, 'created_at', i.created_at)
                        order by i.created_at desc), '[]'::jsonb)
                        from public.interventions i where i.student_id = p.id)
  );
end
$$;

commit;
