-- Rollback of 172: fail_voice_attempt no longer accepts 'too_short' (deploy voice-score without MF-115 first).
begin;
create or replace function public.fail_voice_attempt(_id uuid, _lease_token uuid, _notes text, _reason text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $fn$
declare n integer;
begin
  if _reason not in ('silence', 'too_few_words', 'repetitive', 'off_topic', 'closed') then
    raise exception 'unknown reason %', _reason;
  end if;
  update public.voice_explanations
     set status = 'failed',
         communication_notes = coalesce(_notes, communication_notes),
         evaluation = coalesce(evaluation, '{}'::jsonb) || jsonb_build_object('attempt_fail', _reason),
         scoring_claimed_at = null,
         scoring_lease_token = null
   where id = _id and scoring_lease_token = _lease_token;
  get diagnostics n = row_count;
  return n > 0;
end $fn$;
commit;
