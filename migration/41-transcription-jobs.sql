-- 41: Step 6 - async transcription via Cloud Tasks (staging only, not yet
-- applied to production). voice_explanations already has a `status` column,
-- but it tracks the SCORING lifecycle (recorded/scored/failed) - this adds a
-- SEPARATE set of columns for the TRANSCRIPTION lifecycle so the existing
-- scoring state machine is untouched.
--
-- Defaults to 'completed' so every existing row, and every row the OLD
-- synchronous path still inserts (transcript already known at insert time),
-- needs no backfill and no code change to keep meaning what it always meant.
-- Only the NEW async enqueue path explicitly inserts 'pending'.
begin;

alter table public.voice_explanations
  add column if not exists transcription_status text not null default 'completed'
    check (transcription_status in ('pending', 'processing', 'completed', 'failed')),
  add column if not exists transcription_claimed_at timestamptz,
  add column if not exists transcription_attempts integer not null default 0,
  add column if not exists transcription_error text,
  add column if not exists transcription_idempotency_key text unique;

create index if not exists voice_explanations_transcription_status_idx
  on public.voice_explanations (transcription_status)
  where transcription_status in ('pending', 'processing');

-- ── claim: the real idempotency guarantee ───────────────────────────────────
-- Proceeds only if the row is still pending, OR was claimed by a worker that
-- has gone silent past the staleness window (crashed mid-processing, or a
-- request that never reached the worker at all). A duplicate delivery, or a
-- retry that arrives while a healthy attempt is still inside its window,
-- claims nothing and the worker does no repeat work - this lives in the
-- database, not in worker memory, so it holds even across a worker restart.
create or replace function public.claim_transcription_job(_id uuid, _stale_after_seconds integer default 180)
returns table (id uuid, student_id uuid, storage_path text, task_id uuid, attempts integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  return query
  update public.voice_explanations v
     set transcription_status = 'processing',
         transcription_claimed_at = now(),
         transcription_attempts = v.transcription_attempts + 1
   where v.id = _id
     and (
       v.transcription_status = 'pending'
       or (v.transcription_status = 'processing'
           and v.transcription_claimed_at < now() - make_interval(secs => _stale_after_seconds))
     )
  returning v.id, v.student_id, v.storage_path, v.task_id, v.transcription_attempts;
end $function$;

create or replace function public.complete_transcription_job(
  _id uuid, _transcript text, _segments jsonb default null, _word_count integer default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  update public.voice_explanations
     set transcript = _transcript,
         transcript_segments = coalesce(_segments, transcript_segments),
         word_count = coalesce(_word_count, word_count),
         transcript_source = 'server',
         transcription_status = 'completed',
         transcription_error = null
   where id = _id and transcription_status = 'processing';
  get diagnostics n = row_count;
  return n > 0;
end $function$;

-- Drops the earlier 2-argument version of this function from within this same
-- Step 6 work: `create or replace` does not replace a function whose
-- parameter list changed, it adds a second overload instead, and two
-- same-named RPCs of different arity is exactly the kind of ambiguity
-- PostgREST cannot resolve. Safe to drop unconditionally - nothing outside
-- this migration ever called the 2-argument form.
drop function if exists public.fail_transcription_job(uuid, text);

-- _terminal=false (a transient failure, more Cloud Tasks attempts remain)
-- returns the row to 'pending' so the queue's own next automatic retry can
-- reclaim it through the ordinary pending branch of claim_transcription_job -
-- a row marked 'failed' can never be reclaimed by that function again, so
-- doing this unconditionally on every failure would silently turn off
-- retries after the very first one. Only the worker's last allowed attempt
-- (by the queue's own configured max-attempts) passes _terminal=true.
create or replace function public.fail_transcription_job(_id uuid, _error text, _terminal boolean default true)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  update public.voice_explanations
     set transcription_status = case when _terminal then 'failed' else 'pending' end,
         transcription_error = left(_error, 500)
   where id = _id and transcription_status = 'processing';
  get diagnostics n = row_count;
  return n > 0;
end $function$;

grant execute on function
  public.claim_transcription_job(uuid, integer),
  public.complete_transcription_job(uuid, text, jsonb, integer),
  public.fail_transcription_job(uuid, text, boolean)
  to authenticated, service_role;

commit;
notify pgrst, 'reload schema';
