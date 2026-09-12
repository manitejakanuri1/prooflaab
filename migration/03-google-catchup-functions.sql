-- The eight functions and the grants the Google database was still missing.
--
-- Found by minting a service_role token and calling is_admin() through
-- PostgREST, which answered "permission denied for function is_admin". That one
-- failure led to comparing every function and every grant on both sides, and
-- turned up more than a missing permission.
--
-- What was actually wrong: Google still had the pre-stage75 versions of the lot
-- template functions, keyed by _level_id. Supabase moved them to
-- _source_content_id when lots were delinked from tracks. A comparison by name
-- alone showed them as present, which is how they were missed the first time -
-- two functions with the same name and different arguments are two functions.
--
-- The six superseded _level_id versions are dropped. They have to be: the new
-- versions take the same argument TYPES and differ only in parameter name, and
-- PostgreSQL refuses that with "cannot change name of input parameter". Supabase
-- has none of these six left, so dropping them is what makes the two match.
--
-- is_last_step(_level_id) and record_topic_attempt(..._level_id..) also mention
-- _level_id and are deliberately NOT touched - Supabase still has both, because
-- those two really are about levels.
--
-- Definitions read out of the 12 September backup. Safe to run twice.

begin;

-- ---------------------------------------------------------------------------
-- 1. drop the six that stand in the way
-- ---------------------------------------------------------------------------

drop function if exists public.claim_lot_template(_level_id uuid);
drop function if exists public.ensure_and_claim_lot_template(_level_id uuid);
drop function if exists public.seed_lot_template(_level_id uuid);
drop function if exists public.release_lot_template(_level_id uuid, _token uuid);
drop function if exists public.touch_lot_template(_level_id uuid, _token uuid);
drop function if exists public.save_lot_template(_level_id uuid, _token uuid, _title text,
  _scenario text, _code_sample text, _source_jd text, _difficulty text, _estimate_minutes integer,
  _lot_category text, _sandbox_config_id uuid, _rubric_config_id uuid);

-- ---------------------------------------------------------------------------
-- 2. the eight functions, as Supabase has them
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_lot_template(_source_content_id uuid)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with claimed as (
    update public.lot_templates
       set generating_since = now(), generating_by = gen_random_uuid()
     where source_content_id = _source_content_id
       and origin = 'seed'
       and (generating_since is null or generating_since < now() - interval '2 minutes')
    returning generating_by
  )
  select generating_by from claimed;
$function$
;
CREATE OR REPLACE FUNCTION public.ensure_and_claim_lot_template(_source_content_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not exists (select 1 from public.lot_templates where source_content_id = _source_content_id) then
    perform public.seed_lot_template(_source_content_id);
  end if;
  return public.claim_lot_template(_source_content_id);
end $function$
;
CREATE OR REPLACE FUNCTION public.next_lot_source(_student_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with mine as (
    select distinct k.source_content_id
      from public.tasks k
     where k.student_id = _student_id and k.source_content_id is not null
  ),
  my_college as (
    select college_id from public.student_profiles where id = _student_id
  ),
  fresh as (
    select sc.id
      from public.source_content sc
     where sc.id not in (select source_content_id from mine)
     order by
       (sc.submitted_by_college_id is not null
          and sc.submitted_by_college_id = (select college_id from my_college)) desc,
       (sc.submitted_by_college_id is not null) desc,
       sc.fetched_at asc
     limit 1
  ),
  reuse as (
    select sc.id
      from public.source_content sc
      left join public.tasks k
        on k.source_content_id = sc.id and k.student_id = _student_id
     group by sc.id
     order by max(k.lot_date) asc nulls first
     limit 1
  )
  select coalesce((select id from fresh), (select id from reuse));
$function$
;
CREATE OR REPLACE FUNCTION public.release_lot_template(_source_content_id uuid, _token uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  update public.lot_templates
     set generating_since = null, generating_by = null
   where source_content_id = _source_content_id and generating_by = _token;
$function$
;
CREATE OR REPLACE FUNCTION public.save_lot_template(_source_content_id uuid, _token uuid, _title text, _scenario text, _code_sample text, _source_jd text, _difficulty text, _estimate_minutes integer, _lot_category text, _sandbox_config_id uuid DEFAULT NULL::uuid, _rubric_config_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with saved as (
    update public.lot_templates
       set title = _title, scenario = _scenario, code_sample = _code_sample,
           source_jd = _source_jd, difficulty = _difficulty,
           estimate_minutes = _estimate_minutes, lot_category = _lot_category,
           sandbox_config_id = _sandbox_config_id, rubric_config_id = _rubric_config_id,
           origin = 'ai', generating_since = null, generating_by = null,
           updated_at = now()
     where source_content_id = _source_content_id and generating_by = _token
    returning 1
  )
  select exists (select 1 from saved);
$function$
;
CREATE OR REPLACE FUNCTION public.seed_lot_template(_source_content_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c record;
  fallback_rubric uuid;
begin
  select * into c from public.source_content where id = _source_content_id;
  if c is null then return; end if;

  select id into fallback_rubric from public.task_rubric_config where is_generic_fallback limit 1;

  insert into public.lot_templates
    (source_content_id, title, scenario, difficulty, estimate_minutes, lot_category, origin, rubric_config_id)
  values (
    _source_content_id,
    coalesce(c.title, 'Today''s real question'),
    'Build the smallest working thing that proves you understand ' ||
      coalesce(c.title, 'this') || '. Submit what you built, then record sixty ' ||
      'seconds explaining why your approach is right and what you would do ' ||
      'differently with more time.',
    'Medium',
    20,
    'technical',
    'seed',
    fallback_rubric)
  on conflict (source_content_id) do nothing;
end $function$
;
CREATE OR REPLACE FUNCTION public.start_task_assignment(_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  caller     uuid := auth.uid();
  profile_id uuid;
  t          record;
  prev       text;
begin
  if caller is null then
    return jsonb_build_object('ok', false, 'reason', 'not authenticated');
  end if;

  select id into profile_id from public.student_profiles where user_id = caller;
  if profile_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no student profile');
  end if;

  select id, student_id into t from public.tasks where id = _task_id;
  if t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no such task');
  end if;

  prev := current_setting('app.system_write', true);
  perform set_config('app.system_write', 'on', true);

  if t.student_id = profile_id then
    -- Direct task, owned outright by this student.
    update public.tasks
       set started_at = coalesce(started_at, now()), status = 'In Progress'
     where id = _task_id and started_at is null;
  else
    -- Assigned task: only this student's own assignment row may move, and
    -- only forward from 'assigned' - never off 'completed' or anything a
    -- reviewer set.
    update public.task_assignments
       set status = 'in_progress', updated_at = now()
     where task_id = _task_id and student_id = profile_id and status = 'assigned';

    if not found then
      perform set_config('app.system_write', coalesce(prev, ''), true);
      return jsonb_build_object('ok', false, 'reason', 'not assigned to you, or already started');
    end if;

    -- Several students can share one assigned task row. started_at here is
    -- just "somebody has begun this" for anything that reads it off tasks
    -- directly; the per-student truth lives on task_assignments.status
    -- above. First starter sets it, a later one does not reset it.
    update public.tasks
       set started_at = coalesce(started_at, now())
     where id = _task_id and started_at is null;
  end if;

  perform set_config('app.system_write', coalesce(prev, ''), true);
  return jsonb_build_object('ok', true);
end
$function$
;
CREATE OR REPLACE FUNCTION public.touch_lot_template(_source_content_id uuid, _token uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with beat as (
    update public.lot_templates set generating_since = now()
     where source_content_id = _source_content_id and generating_by = _token
    returning 1
  )
  select exists (select 1 from beat);
$function$
;

-- ---------------------------------------------------------------------------
-- 3. the EXECUTE grants they came with
-- ---------------------------------------------------------------------------

grant execute on function public.claim_lot_template(_source_content_id uuid) to anon;
grant execute on function public.claim_lot_template(_source_content_id uuid) to authenticated;
grant execute on function public.claim_lot_template(_source_content_id uuid) to service_role;
grant execute on function public.ensure_and_claim_lot_template(_source_content_id uuid) to anon;
grant execute on function public.ensure_and_claim_lot_template(_source_content_id uuid) to authenticated;
grant execute on function public.ensure_and_claim_lot_template(_source_content_id uuid) to service_role;
grant execute on function public.is_admin() to service_role;
grant execute on function public.my_todays_lot() to anon;
grant execute on function public.my_todays_lot() to service_role;
grant execute on function public.next_lot_source(_student_id uuid) to anon;
grant execute on function public.next_lot_source(_student_id uuid) to authenticated;
grant execute on function public.next_lot_source(_student_id uuid) to service_role;
grant execute on function public.release_lot_template(_source_content_id uuid, _token uuid) to anon;
grant execute on function public.release_lot_template(_source_content_id uuid, _token uuid) to authenticated;
grant execute on function public.release_lot_template(_source_content_id uuid, _token uuid) to service_role;
grant execute on function public.save_lot_template(_source_content_id uuid, _token uuid, _title text, _scenario text, _code_sample text, _source_jd text, _difficulty text, _estimate_minutes integer, _lot_category text, _sandbox_config_id uuid, _rubric_config_id uuid) to anon;
grant execute on function public.save_lot_template(_source_content_id uuid, _token uuid, _title text, _scenario text, _code_sample text, _source_jd text, _difficulty text, _estimate_minutes integer, _lot_category text, _sandbox_config_id uuid, _rubric_config_id uuid) to authenticated;
grant execute on function public.save_lot_template(_source_content_id uuid, _token uuid, _title text, _scenario text, _code_sample text, _source_jd text, _difficulty text, _estimate_minutes integer, _lot_category text, _sandbox_config_id uuid, _rubric_config_id uuid) to service_role;
grant execute on function public.seed_lot_template(_source_content_id uuid) to anon;
grant execute on function public.seed_lot_template(_source_content_id uuid) to authenticated;
grant execute on function public.seed_lot_template(_source_content_id uuid) to service_role;
grant execute on function public.start_task_assignment(_task_id uuid) to anon;
grant execute on function public.start_task_assignment(_task_id uuid) to authenticated;
grant execute on function public.start_task_assignment(_task_id uuid) to service_role;
grant execute on function public.touch_lot_template(_source_content_id uuid, _token uuid) to anon;
grant execute on function public.touch_lot_template(_source_content_id uuid, _token uuid) to authenticated;
grant execute on function public.touch_lot_template(_source_content_id uuid, _token uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. refuse to commit unless the failure that started this is fixed
-- ---------------------------------------------------------------------------

do $$
begin
  if not has_function_privilege('service_role', 'public.is_admin()', 'EXECUTE') then
    raise exception 'service_role still cannot execute is_admin()';
  end if;
  if to_regprocedure('public.start_task_assignment(uuid)') is null then
    raise exception 'start_task_assignment was not created';
  end if;
  if to_regprocedure('public.next_lot_source(uuid)') is null then
    raise exception 'next_lot_source was not created';
  end if;
  if to_regprocedure('public.claim_lot_template(uuid)') is null then
    raise exception 'claim_lot_template was not reinstalled after the drop';
  end if;
  if to_regprocedure('public.is_last_step(uuid)') is null then
    raise exception 'is_last_step was dropped by mistake - it should have been left alone';
  end if;
  raise notice 'function catch-up complete';
end $$;

commit;
