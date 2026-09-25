-- 44: Step 6F - staging only, not applied to production.
--
-- voice-score had no protection against two concurrent calls for the same
-- recording: nothing checked whether it had already been scored, or was
-- being scored right now, before calling DeepSeek and writing the result.
-- The client-side scoringInFlightRef added in Step 6E only protects one
-- mounted component - two browser tabs (or a tab plus a retry from a
-- reopened modal elsewhere) could both pass it and both grade the same
-- recording, at twice the DeepSeek cost and with whichever write happened
-- last silently winning.
--
-- claim_voice_scoring is the same shape as claim_transcription_job: an
-- atomic UPDATE...WHERE, not a read-then-write, so two concurrent callers
-- can never both see "not yet scored, not yet claimed" as true at once.
-- One of them gets the claim and proceeds to DeepSeek; the other gets
-- nothing back and returns the row's own current score instead of grading
-- a second time. A short TTL (not a permanent lock) means a claim from a
-- request that crashed before writing a result - or was simply slow - does
-- not strand the recording unscored forever; voice-score itself also
-- releases its own claim immediately on a failure, rather than making a
-- prompt retry wait out the TTL.
begin;

alter table public.voice_explanations
  add column if not exists scoring_claimed_at timestamptz;

create or replace function public.claim_voice_scoring(_id uuid, _claim_ttl_seconds integer default 120)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  update public.voice_explanations
     set scoring_claimed_at = now()
   where id = _id
     and status <> 'scored'
     and (scoring_claimed_at is null
          or scoring_claimed_at < now() - make_interval(secs => _claim_ttl_seconds));
  get diagnostics n = row_count;
  return n > 0;
end $function$;

revoke all on function public.claim_voice_scoring(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_voice_scoring(uuid, integer) to service_role;

commit;
notify pgrst, 'reload schema';
