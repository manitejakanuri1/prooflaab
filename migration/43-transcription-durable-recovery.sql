-- 43: Step 6C - staging only, not applied to production.
--
-- Three gaps found reviewing the Step 6B pipeline before connecting the UI:
--
-- (1) transcription-reap (migration 42's reap_stale_transcription_jobs) flips
--     a stale row to 'pending' and only THEN asks Cloud Tasks for a
--     replacement task. If that Cloud Tasks call fails - quota, a transient
--     5xx, the queue paused - the row is left 'pending' with no task pointed
--     at it and no code path left to notice: reap only ever looks at
--     'processing' rows, so a 'pending' row is invisible to it forever.
--     transcription-enqueue has the same shape of gap: its own database
--     INSERT can succeed and its own Cloud Tasks call can still fail, and
--     nothing after that first attempt ever revisits the row either.
--
--     Fixed by replacing the flip-then-enqueue reap with a single recovery
--     function that finds BOTH shapes of stranded row - a 'pending' row past
--     a grace period whose own enqueue was never confirmed
--     (transcription_enqueued_at is null), and a 'processing' row whose lease
--     has gone stale - and, for either, does not change transcription_status
--     at all. It only marks the row as "a recovery attempt is in flight" via
--     a separate reap-only claim (transcription_reap_claimed_at /
--     transcription_reap_attempts), then hands the caller the id to
--     re-enqueue. If the Cloud Tasks call after that then fails, the row is
--     completely unchanged from before the attempt - still 'pending' with no
--     confirmed task, or still 'processing' with its original stale lease -
--     so the NEXT scheduled run finds it again once the short reap-claim
--     window (default 60s) has itself expired. The row is never left in a
--     state that depends on the Cloud Tasks call having worked.
--
--     A 'processing' row is deliberately never touched by this function
--     (never reset to 'pending', never given a new lease here) - the actual
--     worker's own claim_transcription_job is what performs that
--     transition, exactly as if the replacement task were the first attempt.
--     Two replacement tasks racing for the same lease is the same
--     duplicate-delivery case already proven safe in Step 6B: only the first
--     claim wins, the second finds nothing.
--
--     Bounded by transcription_reap_attempts: once a row has been handed out
--     for recovery _max_attempts times without ever completing, it is marked
--     'failed' with a visible error instead of being retried forever - an
--     unbounded loop here would mean unbounded Cloud Tasks calls for a row
--     that can never succeed (permanently missing audio, a permanently
--     misconfigured path).
--
-- (2) The old synchronous path lets a signed-in student INSERT their own
--     voice_explanations row directly. Tested against the real deployed
--     staging endpoint: a student can insert a row with a fabricated
--     transcript, transcript_source='server', status='scored' and
--     communication_score=100 in one call - no audio, no Whisper, no LLM
--     grading call - and PostgREST accepts it (201), because the ownership
--     RLS policy only checks student_id and the protect_voice_explanations
--     trigger only runs on UPDATE, never INSERT. The same gap in miniature:
--     RLS never checked that task_id/proof_id belong to the same student, so
--     a direct insert could attach a recording to someone else's task too.
--
--     Fixed with a BEFORE INSERT trigger, skipped only for a service_role
--     caller (transcription-enqueue and the async pipeline's own writes,
--     which are already trusted). For every other insert it force-sets every
--     backend-controlled field regardless of what the client sent -
--     transcript_source to 'browser' (never 'server'), status to 'recorded',
--     communication_score/notes to null, word_count recomputed from the
--     transcript text actually given rather than trusted as a separate
--     number, and every async-pipeline column (transcription_status,
--     idempotency_key, lease token, attempts, claimed_at, the two reap
--     columns) reset to the values a legacy row should have. It also checks
--     task_id/proof_id against the same student_id. This does not change
--     what text a student can put in transcript - that is already
--     client-supplied in the existing browser-STT design, unchanged here -
--     it only stops a direct insert from also claiming server provenance or
--     a server-issued score, and stops it from mislabeling whose task the
--     recording belongs to.
begin;

-- ── (1) durable recovery ─────────────────────────────────────────────────
alter table public.voice_explanations
  add column if not exists transcription_enqueued_at timestamptz,
  add column if not exists transcription_reap_claimed_at timestamptz,
  add column if not exists transcription_reap_attempts integer not null default 0;

drop function if exists public.reap_stale_transcription_jobs(integer);
drop function if exists public.claim_transcription_recovery(integer, integer, integer, integer);

create or replace function public.claim_transcription_recovery(
  _stale_after_seconds integer default 180,
  _pending_grace_seconds integer default 20,
  _reap_claim_ttl_seconds integer default 60,
  _max_reap_attempts integer default 8
)
returns table (id uuid, storage_path text, kind text, attempt integer)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Give up on a row that has been handed out for recovery too many times
  -- without ever completing - visible and terminal, not a silent forever-loop.
  update public.voice_explanations
     set transcription_status = 'failed',
         transcription_error = 'exceeded automatic recovery attempts'
   where transcription_status in ('pending', 'processing')
     and transcription_reap_attempts >= _max_reap_attempts;

  return query
  update public.voice_explanations v
     set transcription_reap_claimed_at = now(),
         transcription_reap_attempts = v.transcription_reap_attempts + 1
   where v.transcription_reap_attempts < _max_reap_attempts
     and (v.transcription_reap_claimed_at is null
          or v.transcription_reap_claimed_at < now() - make_interval(secs => _reap_claim_ttl_seconds))
     and (
       (v.transcription_status = 'pending'
        and v.transcription_enqueued_at is null
        and v.created_at < now() - make_interval(secs => _pending_grace_seconds))
       or
       (v.transcription_status = 'processing'
        and v.transcription_claimed_at < now() - make_interval(secs => _stale_after_seconds))
     )
  returning v.id, v.storage_path,
    (case when v.transcription_status = 'pending' then 'pending' else 'processing' end),
    v.transcription_reap_attempts;
end $function$;

revoke all on function public.claim_transcription_recovery(integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_transcription_recovery(integer, integer, integer, integer)
  to service_role;

-- ── (2) legacy-insert forgery guard ─────────────────────────────────────────
create or replace function public.guard_voice_explanations_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.role() = 'service_role' then
    return new; -- transcription-enqueue and the async pipeline are already trusted
  end if;

  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.student_id = new.student_id
  ) then
    raise exception 'task_id does not belong to this student';
  end if;
  if new.proof_id is not null and not exists (
    select 1 from public.proof_uploads p where p.id = new.proof_id and p.student_id = new.student_id
  ) then
    raise exception 'proof_id does not belong to this student';
  end if;

  new.transcript_source := 'browser';
  new.status := 'recorded';
  new.communication_score := null;
  new.communication_notes := null;
  new.word_count := case
    when new.transcript is not null and length(trim(new.transcript)) > 0
    then array_length(regexp_split_to_array(trim(new.transcript), '\s+'), 1)
    else 0
  end;
  new.transcription_status := 'completed';
  new.transcription_idempotency_key := null;
  new.transcription_claimed_at := null;
  new.transcription_attempts := 0;
  new.transcription_error := null;
  new.transcription_lease_token := null;
  new.transcription_enqueued_at := null;
  new.transcription_reap_claimed_at := null;
  new.transcription_reap_attempts := 0;
  return new;
end $function$;

drop trigger if exists guard_voice_explanations_insert on public.voice_explanations;
create trigger guard_voice_explanations_insert
  before insert on public.voice_explanations
  for each row execute function public.guard_voice_explanations_insert();

commit;
notify pgrst, 'reload schema';
