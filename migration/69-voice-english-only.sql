-- 69: spoken explanations are in English; the language heard is recorded with the evidence.
-- The transcriber now detects the language before transcribing (accent plays no part: see
-- transcriber/language_gate.py). The worker calls set_transcription_language() while it holds
-- the job's lease:
--   _reject = false -> what was heard (language, probabilities, model, config, rule) is stored
--                      under evaluation.transcription and the job continues;
--   _reject = true  -> the attempt is closed: no transcript, never scored, the student sees
--                      "Please record your explanation in English." and can record again.
-- The attempt stays in the history; it cannot be or become the authoritative recording
-- (migration 61's fallback returns authority to the newest scored attempt).
begin;

create or replace function public.set_transcription_language(
  _id uuid, _lease_token uuid, _meta jsonb, _reject boolean default false)
returns boolean
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare n integer;
begin
  if _meta is null or jsonb_typeof(_meta) <> 'object' then
    raise exception 'set_transcription_language: _meta must be an object';
  end if;
  update public.voice_explanations v
     set evaluation = jsonb_build_object('transcription', _meta)
                      || case when _reject then '{"flags": ["non_english"]}'::jsonb else '{}'::jsonb end,
         transcription_status = case when _reject then 'failed' else v.transcription_status end,
         transcription_error  = case when _reject then 'non_english' else v.transcription_error end,
         status               = case when _reject then 'failed' else v.status end,
         communication_notes  = case when _reject then 'Please record your explanation in English.'
                                     else v.communication_notes end,
         transcription_lease_token = case when _reject then null else v.transcription_lease_token end,
         transcription_claimed_at  = case when _reject then null else v.transcription_claimed_at end
   where v.id = _id
     and v.transcription_status = 'processing'
     and v.transcription_lease_token = _lease_token
     and v.status <> 'scored';
  get diagnostics n = row_count;
  return n > 0;
end $function$;

revoke all on function public.set_transcription_language(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.set_transcription_language(uuid, uuid, jsonb, boolean) to service_role;

-- A scorer must never grade an attempt the gate closed, whoever asks.
create or replace function public.voice_not_english(_id uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select coalesce((select v.transcription_error = 'non_english'
                      or coalesce(v.evaluation -> 'flags', '[]'::jsonb) ? 'non_english'
                     from public.voice_explanations v where v.id = _id), false);
$function$;
revoke all on function public.voice_not_english(uuid) from public, anon, authenticated;
grant execute on function public.voice_not_english(uuid) to service_role;

do $$
declare sig text := 'public.set_transcription_language(uuid, uuid, jsonb, boolean)';
begin
  if has_function_privilege('authenticated', sig, 'execute') or has_function_privilege('anon', sig, 'execute') then
    raise exception '69 self-check: a browser can set the language decision';
  end if;
  if not has_function_privilege('service_role', sig, 'execute') then
    raise exception '69 self-check: the worker cannot set the language decision';
  end if;
  -- Wrong lease: nothing happens.
  if public.set_transcription_language(gen_random_uuid(), gen_random_uuid(), '{"language":"te"}'::jsonb, true) then
    raise exception '69 self-check: a decision was accepted without a matching lease';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
