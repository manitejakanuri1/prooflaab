-- 103 rollback: restores the state before migration 103.
-- Policies and tasks_clamp_student_insert are copied verbatim from the repository state before 103 (clamp from
-- supabase/migrations/20261001000800_stage70_rubric_tasks.sql; its live staging body was checked equal on 9 Oct 2026).
-- record_task_submission is UN-PATCHED IN PLACE: only the lines 103 inserted are removed, so migrations 91/93 stay.
-- WARNING: this RE-OPENS findings S29-01..S29-05: students may again insert and update their own tasks, and a self-made
-- task can again become a passed submission. Use only if 103 itself breaks production; prefer a forward fix.
-- Deliberately NOT undone: tasks.inserted_by stays (a nullable marker column; dropping it loses provenance data);
-- anon stays revoked on public_resume_scorecards / llm_usage_by_student (the stage48 / stage14 intent);
-- user_roles_self_claim is not recreated (migration 100 owns that decision).
begin;

drop trigger if exists tasks_zz_guard_integrity on public.tasks;
drop function if exists public.tasks_guard_integrity();
drop policy if exists tasks_admin_insert on public.tasks;
drop policy if exists tasks_college_insert on public.tasks;
drop policy if exists tasks_admin_update on public.tasks;
drop policy if exists tasks_own_insert on public.tasks;
drop policy if exists tasks_own_update on public.tasks;
create policy tasks_own_insert on public.tasks
  for insert to authenticated
  with check (student_id = (select auth.uid()) or public.is_admin());
create policy tasks_own_update on public.tasks
  for update to authenticated
  using (student_id = (select auth.uid()) or public.is_admin())
  with check (student_id = (select auth.uid()) or public.is_admin());

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
revoke all on function public.tasks_clamp_student_insert() from public, anon, authenticated;
drop function if exists public.generic_fallback_rubric_id();

create temp table _103r_before on commit drop as
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype,
         position('_passed_count = _total_count' in pg_get_functiondef(p.oid)) > 0 as had_every_test_rule
    from pg_proc p where p.oid = 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;

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
  if position('-- 103: a task its own student inserted is never evidence.' in def) = 0 then
    raise notice '103 rollback: record_task_submission does not carry the 103 checks';
    return;
  end if;
  n := (length(def) - length(replace(def, new_select, ''))) / length(new_select);
  if n <> 1 then raise exception '103 rollback: expected the 103 task select exactly once, found %', n; end if;
  n := (length(def) - length(replace(def, new_guard, ''))) / length(new_guard);
  if n <> 1 then raise exception '103 rollback: expected the 103 checks exactly once, found %', n; end if;
  execute replace(replace(def, new_guard, old_guard), new_select, old_select);
end $$;

do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  b record; a record; def text := pg_get_functiondef('public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure);
begin
  select * into b from _103r_before;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype into a from pg_proc p where p.oid = f;
  if a.proowner <> b.proowner or a.prosecdef <> b.prosecdef or a.proconfig is distinct from b.proconfig
     or a.acl is distinct from b.acl or a.provolatile <> b.provolatile or a.prorettype <> b.prorettype then
    raise exception '103 rollback: record_task_submission changed more than the 103 checks';
  end if;
  if b.had_every_test_rule and position('_passed_count = _total_count' in def) = 0 then
    raise exception '103 rollback: migration 91''s every-test rule was lost';
  end if;
  if position('-- 103:' in def) > 0 then raise exception '103 rollback: 103 text still in record_task_submission'; end if;
end $$;

drop trigger if exists task_templates_set_owner on public.task_templates;
drop function if exists public.task_templates_set_owner();
drop policy if exists task_templates_college_insert on public.task_templates;
drop policy if exists task_templates_read on public.task_templates;
create policy task_templates_read on public.task_templates
  for select to authenticated
  using ((select public.is_admin()) or (select public.my_college_id()) is not null);

drop trigger if exists audit_logs_set_actor on public.audit_logs;
drop function if exists public.audit_logs_set_actor();
drop policy if exists audit_logs_admin_insert on public.audit_logs;
drop policy if exists audit_logs_college_insert on public.audit_logs;

drop trigger if exists job_opportunities_keep_moderation on public.job_opportunities;
drop function if exists public.job_opportunities_keep_moderation();

do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'tasks'
       and policyname in ('tasks_own_insert', 'tasks_own_update')) <> 2 then
    raise exception '103 rollback: tasks student policies not restored';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and policyname in ('tasks_college_insert', 'tasks_admin_insert', 'tasks_admin_update',
                                 'task_templates_college_insert', 'audit_logs_college_insert', 'audit_logs_admin_insert')) then
    raise exception '103 rollback: a 103 policy is still present';
  end if;
  if exists (select 1 from pg_trigger where not tgisinternal and tgname in
              ('tasks_zz_guard_integrity', 'task_templates_set_owner', 'audit_logs_set_actor', 'job_opportunities_keep_moderation')) then
    raise exception '103 rollback: a 103 trigger is still present';
  end if;
  if has_function_privilege('authenticated', 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])', 'execute') then
    raise exception '103 rollback: record_task_submission exposed';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
