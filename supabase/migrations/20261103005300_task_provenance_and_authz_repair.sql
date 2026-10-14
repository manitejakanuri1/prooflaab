-- 103: task provenance and evidence integrity, college task assignment, and four smaller closes (S30).
-- Requires 100 (managed accounts only). Findings S29-01..S29-08: docs/sidhu-qa/S30-AUTHORIZATION-REPAIR.md.
--
-- What changes, in one line each:
--   1. tasks.inserted_by records WHO inserted a row directly through the API (null = a server path). It is set by
--      a trigger, never by the caller, so it cannot be forged.
--   2. Students lose direct INSERT/UPDATE on tasks. No screen used them: every legitimate writer (daily Lots, company
--      Lots, roadmap tasks, submissions, start) is a SECURITY DEFINER function or the service role.
--   3. A verified college may insert tasks for ITS OWN students only (manual Assign Task). Admins keep full access.
--   4. tasks_clamp_student_insert: a browser insert can no longer choose status, checker, sponsor, origin, Lot
--      fields or visibility, and can never be a self-authored task. College tasks get the generic written checker.
--   5. tasks_zz_guard_integrity (named to fire LAST among BEFORE UPDATE triggers): a non-admin browser UPDATE that
--      would change any column, including one changed by an earlier trigger, is refused. Defence in depth.
--   6. record_task_submission (patched IN PLACE, keeping migrations 91/93) refuses a self-authored task, a submitter
--      who neither owns nor was assigned the task, and a checker that is not the task's own.
--   7. task_templates: a verified college may save templates; colleges read admin templates and their own only.
--   8. audit_logs: a verified college (and an admin) may record "Task Created" for tasks that college created.
--   9. job_opportunities: only admins and verified colleges publish directly; everyone else stays 'pending'.
--  10. public_resume_scorecards / llm_usage_by_student: anon privileges revoked again (migration 01 re-granted them).
--  11. user_roles_self_claim dropped again (idempotent; 100 already drops it).
-- Nothing here rewrites or deletes existing rows.
begin;

-- 1 ---------------------------------------------------------------------------------------------------------------
alter table public.tasks add column if not exists inserted_by uuid;
comment on column public.tasks.inserted_by is
  'Set by trigger: the signed-in account that inserted this row through the API; null when a server path inserted it.';

-- 2, 3 ------------------------------------------------------------------------------------------------------------
drop policy if exists tasks_own_insert on public.tasks;
drop policy if exists tasks_own_update on public.tasks;
drop policy if exists tasks_admin_insert on public.tasks;
drop policy if exists tasks_college_insert on public.tasks;
drop policy if exists tasks_admin_update on public.tasks;

create policy tasks_admin_insert on public.tasks
  for insert to authenticated
  with check ((select public.is_admin()));

create policy tasks_college_insert on public.tasks
  for insert to authenticated
  with check (
    tasks.created_by_type = 'college'
    and tasks.created_by_college_id is not null
    and tasks.created_by_college_id = (select public.my_college_id())
    and exists (
      select 1 from public.student_profiles p
       where p.id = tasks.student_id
         and p.college_id = tasks.created_by_college_id
    )
  );

create policy tasks_admin_update on public.tasks
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- 4 ---------------------------------------------------------------------------------------------------------------
-- The clamp runs as the caller, and task_rubric_config is admin-only under RLS, so the generic checker's id is read
-- through this definer helper. It returns one id and nothing else.
create or replace function public.generic_fallback_rubric_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.task_rubric_config where is_generic_fallback order by id limit 1;
$$;
revoke all on function public.generic_fallback_rubric_id() from public, anon;
grant execute on function public.generic_fallback_rubric_id() to authenticated, service_role;

-- BEFORE INSERT triggers fire alphabetically: task_default_checker, then this one. So this one has the last word.
-- It stays SECURITY INVOKER on purpose: current_user is 'authenticated' only for a direct API write.
create or replace function public.tasks_clamp_student_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.inserted_by := case when current_user = 'authenticated' then auth.uid() else null end;
  if current_user = 'authenticated' and not public.is_admin() then
    if new.student_id is not distinct from auth.uid() then
      raise exception 'a task cannot be created for yourself' using errcode = '42501';
    end if;
    new.xp := 0;
    new.xp_reward := 0;
    new.suggested_xp := null;
    new.approved_by_admin := false;
    new.status := 'pending';
    new.sandbox_config_id := null;
    new.is_sandbox_task := false;
    new.rubric_config_id := public.generic_fallback_rubric_id();
    new.grading_type := 'written';
    new.sponsored_by := null;
    new.sponsor_criteria := null;
    new.created_by_startup_id := null;
    new.created_by_admin_id := null;
    new.visibility := 'private';
    new.lot_date := null;
    new.lot_number := null;
    new.lot_candidate_id := null;
    new.lot_selection := null;
    new.source := null;
    new.source_content_id := null;
    new.level_id := null;
    new.roadmap_scorecard_id := null;
    new.roadmap_stage_index := null;
    new.is_ai_generated := false;
    new.started_at := null;
    new.completed_at := null;
  end if;
  return new;
end
$$;

-- 5 ---------------------------------------------------------------------------------------------------------------
create or replace function public.tasks_guard_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user = 'authenticated' and not public.is_admin()
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'tasks can only be changed by the server or an administrator' using errcode = '42501';
  end if;
  return new;
end
$$;
drop trigger if exists tasks_zz_guard_integrity on public.tasks;
create trigger tasks_zz_guard_integrity
  before update on public.tasks
  for each row execute function public.tasks_guard_integrity();

-- 6 ---------------------------------------------------------------------------------------------------------------
-- record_task_submission is PATCHED IN PLACE, never re-created: migrations 91 and 93 changed its pass rule inside
-- the live definition (DO blocks), so a CREATE OR REPLACE from an older file would silently undo them. Same method
-- as 91: two anchored text replacements, each refused unless found exactly once; owner, SECURITY DEFINER, config,
-- volatility, return type and grants must be unchanged; 91's every-test rule must survive if it was there.
create temp table _103_before on commit drop as
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype,
         position('_passed_count = _total_count' in pg_get_functiondef(p.oid)) > 0 as had_every_test_rule,
         position('hidden-summary' in pg_get_functiondef(p.oid)) > 0 as had_hidden_summary_rule
    from pg_proc p
   where p.oid = 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;

do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  old_select constant text := E'  select id, student_id, xp_reward, source, level_id into t from public.tasks where id = _task_id;\n';
  new_select constant text := E'  select id, student_id, xp_reward, source, level_id, inserted_by, sandbox_config_id, rubric_config_id\n'
    || E'    into t from public.tasks where id = _task_id;\n';
  old_guard constant text := E'    return jsonb_build_object(''ok'', false, ''reason'', ''task or config missing'');\n  end if;\n';
  new_guard constant text := old_guard
    || E'\n  -- 103: a task its own student inserted is never evidence.\n'
    || E'  if t.inserted_by is not null and t.inserted_by = t.student_id then\n'
    || E'    return jsonb_build_object(''ok'', false, ''reason'', ''self-authored task'');\n'
    || E'  end if;\n'
    || E'  -- 103: only the task''s student, or a student it was assigned to, can be graded on it.\n'
    || E'  if t.student_id is distinct from _student_id\n'
    || E'     and not exists (select 1 from public.task_assignments a\n'
    || E'                      where a.task_id = _task_id and a.student_id = _student_id) then\n'
    || E'    return jsonb_build_object(''ok'', false, ''reason'', ''not this student''''s task'');\n'
    || E'  end if;\n'
    || E'  -- 103: the checker must be the task''s own.\n'
    || E'  if (_sandbox_config_id is not null and _sandbox_config_id is distinct from t.sandbox_config_id)\n'
    || E'     or (_sandbox_config_id is null and _rubric_config_id is distinct from t.rubric_config_id) then\n'
    || E'    return jsonb_build_object(''ok'', false, ''reason'', ''checker does not belong to this task'');\n'
    || E'  end if;\n';
  def text := pg_get_functiondef(f);
  n int;
begin
  if position('-- 103: a task its own student inserted is never evidence.' in def) > 0 then
    raise notice '103: record_task_submission already carries the provenance checks';
    return;
  end if;
  n := (length(def) - length(replace(def, old_select, ''))) / length(old_select);
  if n <> 1 then raise exception '103: expected the task select exactly once in record_task_submission, found %', n; end if;
  n := (length(def) - length(replace(def, old_guard, ''))) / length(old_guard);
  if n <> 1 then raise exception '103: expected the "task or config missing" guard exactly once, found %', n; end if;
  execute replace(replace(def, old_select, new_select), old_guard, new_guard);
end $$;

do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  b record; a record; def text := pg_get_functiondef('public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure);
begin
  select * into b from _103_before;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype into a
    from pg_proc p where p.oid = f;
  if a.proowner <> b.proowner or a.prosecdef <> b.prosecdef or a.proconfig is distinct from b.proconfig
     or a.acl is distinct from b.acl or a.provolatile <> b.provolatile or a.prorettype <> b.prorettype then
    raise exception '103 self-check: record_task_submission changed more than its provenance checks';
  end if;
  if b.had_every_test_rule and position('_passed_count = _total_count' in def) = 0 then
    raise exception '103 self-check: migration 91''s every-test rule was lost';
  end if;
  if b.had_hidden_summary_rule and position('hidden-summary' in def) = 0 then
    raise exception '103 self-check: migration 93''s hidden-summary rule was lost';
  end if;
  if position('-- 103: a task its own student inserted is never evidence.' in def) = 0 then
    raise exception '103 self-check: provenance checks missing from record_task_submission';
  end if;
end $$;

-- 7 ---------------------------------------------------------------------------------------------------------------
create or replace function public.task_templates_set_owner()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.created_by := auth.uid();
  end if;
  return new;
end
$$;
drop trigger if exists task_templates_set_owner on public.task_templates;
create trigger task_templates_set_owner
  before insert on public.task_templates
  for each row execute function public.task_templates_set_owner();

drop policy if exists task_templates_college_insert on public.task_templates;
create policy task_templates_college_insert on public.task_templates
  for insert to authenticated
  with check ((select public.my_college_id()) is not null and created_by = (select auth.uid()));

drop policy if exists task_templates_read on public.task_templates;
create policy task_templates_read on public.task_templates
  for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.my_college_id()) is not null
        and (created_by is null or created_by = (select auth.uid()) or public.has_role(created_by, 'admin')))
  );

-- 8 ---------------------------------------------------------------------------------------------------------------
create or replace function public.audit_logs_set_actor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user = 'authenticated' then
    new.user_id := auth.uid();
    if not public.is_admin() then
      new.college_id := public.my_college_id();
    end if;
  end if;
  return new;
end
$$;
drop trigger if exists audit_logs_set_actor on public.audit_logs;
create trigger audit_logs_set_actor
  before insert on public.audit_logs
  for each row execute function public.audit_logs_set_actor();

drop policy if exists audit_logs_admin_insert on public.audit_logs;
create policy audit_logs_admin_insert on public.audit_logs
  for insert to authenticated
  with check ((select public.is_admin()) and user_id = (select auth.uid()));

drop policy if exists audit_logs_college_insert on public.audit_logs;
create policy audit_logs_college_insert on public.audit_logs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and audit_logs.college_id is not null
    and audit_logs.college_id = (select public.my_college_id())
    and audit_logs.table_name = 'tasks'
    and exists (select 1 from public.tasks t
                 where t.id = audit_logs.record_id
                   and t.created_by_college_id = audit_logs.college_id)
  );

-- 9 ---------------------------------------------------------------------------------------------------------------
create or replace function public.job_opportunities_keep_moderation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' or public.is_admin() then
    return new;
  end if;
  -- A verified college posts to its own placement board without review (existing PostJobDescription behaviour).
  if public.my_college_id() is not null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending';
  elsif new.status is distinct from old.status and new.status is distinct from 'pending' then
    new.status := old.status;
  end if;
  return new;
end
$$;
drop trigger if exists job_opportunities_keep_moderation on public.job_opportunities;
create trigger job_opportunities_keep_moderation
  before insert or update on public.job_opportunities
  for each row execute function public.job_opportunities_keep_moderation();

-- 10 --------------------------------------------------------------------------------------------------------------
revoke all on public.public_resume_scorecards from anon;
revoke all on public.llm_usage_by_student from anon;

-- 11 --------------------------------------------------------------------------------------------------------------
drop policy if exists user_roles_self_claim on public.user_roles;

revoke all on function public.tasks_clamp_student_insert() from public, anon, authenticated;
revoke all on function public.tasks_guard_integrity() from public, anon, authenticated;
revoke all on function public.task_templates_set_owner() from public, anon, authenticated;
revoke all on function public.audit_logs_set_actor() from public, anon, authenticated;
revoke all on function public.job_opportunities_keep_moderation() from public, anon, authenticated;

-- self-check ------------------------------------------------------------------------------------------------------
do $$
declare
  names text[];
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tasks' and column_name = 'inserted_by') then
    raise exception '103: tasks.inserted_by missing';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks'
              and policyname in ('tasks_own_insert', 'tasks_own_update')) then
    raise exception '103: a student write policy on tasks is still present';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'tasks'
       and policyname in ('tasks_admin_insert', 'tasks_college_insert', 'tasks_admin_update')) <> 3 then
    raise exception '103: tasks policies missing';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks'
              and cmd in ('INSERT', 'UPDATE', 'ALL')
              and policyname not in ('tasks_admin_insert', 'tasks_college_insert', 'tasks_admin_update')) then
    raise exception '103: an unexpected write policy on tasks exists';
  end if;
  -- The integrity guard must fire after every other BEFORE UPDATE trigger on tasks (alphabetical order).
  select array_agg(tgname order by tgname) into names
    from pg_trigger
   where tgrelid = 'public.tasks'::regclass and not tgisinternal
     and (tgtype & 2) = 2 and (tgtype & 16) = 16;
  if names[array_length(names, 1)] is distinct from 'tasks_zz_guard_integrity' then
    raise exception '103: tasks_zz_guard_integrity is not the last BEFORE UPDATE trigger (%)', names;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_roles'
              and cmd in ('INSERT', 'ALL') and coalesce(with_check, '') not like '%is_admin%') then
    raise exception '103: a non-admin insert policy on user_roles exists';
  end if;
  if has_table_privilege('anon', 'public.public_resume_scorecards', 'select')
     or has_table_privilege('anon', 'public.llm_usage_by_student', 'select') then
    raise exception '103: anon can still read a scorecard or usage view';
  end if;
  if has_function_privilege('anon', 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])', 'execute')
     or has_function_privilege('authenticated', 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])', 'execute')
     or not has_function_privilege('service_role', 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])', 'execute') then
    raise exception '103: record_task_submission privileges wrong';
  end if;
  if public.generic_fallback_rubric_id() is null then
    raise warning '103: no generic fallback rubric: college manual tasks will have no checker';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
