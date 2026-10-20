-- 127 rollback: restore immediate task completion on code/written pass.
begin;

-- 1. Restore complete_voice_scoring to scoring-only (migration 45)
create or replace function public.complete_voice_scoring(
  _id uuid, _lease_token uuid, _score integer, _notes text
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  update public.voice_explanations
     set communication_score = _score,
         communication_notes = _notes,
         status = 'scored'
   where id = _id and scoring_lease_token = _lease_token;
  get diagnostics n = row_count;
  return n > 0;
end $function$;

revoke all on function public.complete_voice_scoring(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.complete_voice_scoring(uuid, uuid, integer, text) to service_role;

-- 2. Restore record_task_submission to mark completed directly
do $$
declare
  f constant regprocedure := 'public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure;
  def text := pg_get_functiondef(f);
  old_pending constant text := E'    -- 127: Transition to pending_voice; completed_at and XP wait for complete_voice_scoring\n    if t.student_id = _student_id then\n      update public.tasks set status = ''pending_voice'' where id = _task_id and status <> ''completed'';\n    else\n      update public.task_assignments\n         set status = ''pending_voice'', submitted_at = now()\n       where task_id = _task_id and student_id = _student_id and status <> ''completed'';\n    end if;';
  new_complete constant text := E'    if t.student_id = _student_id then\n      update public.tasks set status = ''completed'', completed_at = now() where id = _task_id;\n    else\n      update public.task_assignments\n         set status = ''completed'', completed_at = now(), submitted_at = now()\n       where task_id = _task_id and student_id = _student_id;\n    end if;';
  n int;
begin
  if position('pending_voice' in def) = 0 then
    return;
  end if;
  n := (length(def) - length(replace(def, old_pending, ''))) / length(old_pending);
  if n <> 1 then
    raise exception '127 rollback: expected pending_voice block exactly once, found %', n;
  end if;
  execute replace(def, old_pending, new_complete);
end $$;

commit;
notify pgrst, 'reload schema';
