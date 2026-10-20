-- 20261103011700: Voice-Gated Task Completion and State Machine Integrity (Migration 127).
-- See migration/127-voice-gated-task-completion.sql for documentation.

begin;

create or replace function public.complete_voice_scoring(
  _id uuid, _lease_token uuid, _score integer, _notes text
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  n integer;
  v record;
  t record;
  prev text;
  sub_id uuid;
begin
  update public.voice_explanations
     set communication_score = _score,
         communication_notes = _notes,
         status = 'scored'
   where id = _id and scoring_lease_token = _lease_token
  returning id, task_id, student_id into v;
  get diagnostics n = row_count;
  if n = 0 then return false; end if;

  -- Complete the associated task and award XP once voice explanation is scored
  if v.task_id is not null and v.student_id is not null then
    select id, student_id, xp_reward into t from public.tasks where id = v.task_id;
    if t.id is not null then
      select id into sub_id from public.task_submissions
       where task_id = v.task_id and student_id = v.student_id and status = 'passed'
       order by created_at desc limit 1;

      prev := current_setting('app.system_write', true);
      perform set_config('app.system_write', 'on', true);

      if t.student_id = v.student_id then
        update public.tasks
           set status = 'completed', completed_at = coalesce(completed_at, now())
         where id = v.task_id and status <> 'completed';
      else
        update public.task_assignments
           set status = 'completed', completed_at = coalesce(completed_at, now()), submitted_at = coalesce(submitted_at, now())
         where task_id = v.task_id and student_id = v.student_id and status <> 'completed';
      end if;

      -- Award XP idempotently once per task
      if coalesce(t.xp_reward, 0) > 0 then
        insert into public.xp_logs (student_id, xp_points, source)
        values (v.student_id, t.xp_reward, 'task:' || v.task_id)
        on conflict (student_id, source) where source like 'task:%' do nothing;
        get diagnostics n = row_count;
        if n > 0 then
          update public.student_profiles
             set total_xp = coalesce(total_xp, 0) + t.xp_reward
           where id = v.student_id;
          if sub_id is not null then
            update public.task_submissions set xp_awarded = t.xp_reward where id = sub_id;
          end if;
        end if;
      end if;

      perform set_config('app.system_write', coalesce(prev, ''), true);

      if sub_id is not null then
        perform public.log_activity(v.student_id, 'task_completed', 'task_submissions', sub_id);
      end if;
    end if;
  end if;

  return true;
end $function$;

revoke all on function public.complete_voice_scoring(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.complete_voice_scoring(uuid, uuid, integer, text) to service_role;

create temp table _127_before on commit drop as
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype
    from pg_proc p
   where p.oid = 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;

do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  def text := pg_get_functiondef(f);
  old_complete constant text := E'    if t.student_id = _student_id then\n      update public.tasks set status = ''completed'', completed_at = now() where id = _task_id;\n    else\n      update public.task_assignments\n         set status = ''completed'', completed_at = now(), submitted_at = now()\n       where task_id = _task_id and student_id = _student_id;\n    end if;';
  new_pending constant text := E'    -- 127: Transition to pending_voice; completed_at and XP wait for complete_voice_scoring\n    if t.student_id = _student_id then\n      update public.tasks set status = ''pending_voice'' where id = _task_id and status <> ''completed'';\n    else\n      update public.task_assignments\n         set status = ''pending_voice'', submitted_at = now()\n       where task_id = _task_id and student_id = _student_id and status <> ''completed'';\n    end if;';
  n int;
begin
  if position('pending_voice' in def) > 0 then
    raise notice '127: record_task_submission already sets pending_voice';
    return;
  end if;
  n := (length(def) - length(replace(def, old_complete, ''))) / length(old_complete);
  if n <> 1 then
    raise exception '127: expected the task completion block exactly once, found %', n;
  end if;
  execute replace(def, old_complete, new_pending);
end $$;

do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  b record; a record; def text := pg_get_functiondef(f);
begin
  select * into b from _127_before;
  select p.proowner, p.prosecdef, p.proconfig, p.proacl::text as acl, p.provolatile, p.prorettype into a
    from pg_proc p where p.oid = f;
  if a.proowner <> b.proowner or a.prosecdef <> b.prosecdef or a.proconfig is distinct from b.proconfig
     or a.acl is distinct from b.acl or a.provolatile <> b.provolatile or a.prorettype <> b.prorettype then
    raise exception '127 self-check: record_task_submission privileges or signature changed unexpectedly';
  end if;
  if position('pending_voice' in def) = 0 then
    raise exception '127 self-check: pending_voice transition missing from record_task_submission';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
