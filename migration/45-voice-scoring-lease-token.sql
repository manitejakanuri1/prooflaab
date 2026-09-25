-- 45: Step 6G - staging only, not applied to production.
--
-- Migration 44's claim_voice_scoring only ever checked a timestamp at claim
-- time. Nothing checked it again when the result was actually written -
-- voice-score's final write was a plain
--   update voice_explanations set communication_score=..., status='scored'
--   where id = voice_id
-- with no reference to which claim produced it. That means:
--
--   worker A claims at T=0 (ttl 120s), starts a slow DeepSeek call
--   worker A's claim goes stale at T=120 while it is still running
--   worker B claims at T=121 (the timestamp says stale, so it may), starts
--     its own DeepSeek call, finishes at T=125 and writes a real score
--   worker A finally finishes at T=130 and writes ITS OWN (older, possibly
--     worse) result over worker B's - unconditionally, because nothing
--     about the write path knew worker A's claim was no longer the current
--     one
--
-- The same gap existed in reverse for failure: fail_voice_scoring-equivalent
-- code cleared scoring_claimed_at unconditionally, so a stale worker A's
-- failure could release a claim worker B was actively holding.
--
-- Fixed the same way migration 42 fixed the identical shape of bug for
-- transcription: claim_voice_scoring now mints and returns a fresh lease
-- token every time it succeeds, and the two write paths (complete, fail)
-- both require that exact token to match the row's CURRENT lease before
-- they touch anything. A late write from an expired claim matches nothing
-- - the row's lease has already moved on - and is correctly rejected
-- rather than silently overwriting whatever the newer claim already saved.
begin;

alter table public.voice_explanations
  add column if not exists scoring_lease_token uuid;

drop function if exists public.claim_voice_scoring(uuid, integer);
create or replace function public.claim_voice_scoring(_id uuid, _claim_ttl_seconds integer default 120)
returns table (claimed boolean, lease_token uuid)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  _lease uuid := gen_random_uuid();
  n integer;
begin
  update public.voice_explanations
     set scoring_claimed_at = now(),
         scoring_lease_token = _lease
   where id = _id
     and status <> 'scored'
     and (scoring_claimed_at is null
          or scoring_claimed_at < now() - make_interval(secs => _claim_ttl_seconds));
  get diagnostics n = row_count;
  if n > 0 then
    return query select true, _lease;
  else
    return query select false, null::uuid;
  end if;
end $function$;

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

create or replace function public.fail_voice_scoring(
  _id uuid, _lease_token uuid, _notes text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare n integer;
begin
  update public.voice_explanations
     set status = 'failed',
         communication_notes = coalesce(_notes, communication_notes),
         scoring_claimed_at = null,
         scoring_lease_token = null
   where id = _id and scoring_lease_token = _lease_token;
  get diagnostics n = row_count;
  return n > 0;
end $function$;

-- Lock down privileges AFTER every create/replace above (CREATE FUNCTION
-- resets a function's privileges to Postgres's default - EXECUTE granted
-- to PUBLIC - regardless of an earlier revoke; see migration 42).
revoke all on function
  public.claim_voice_scoring(uuid, integer),
  public.complete_voice_scoring(uuid, uuid, integer, text),
  public.fail_voice_scoring(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function
  public.claim_voice_scoring(uuid, integer),
  public.complete_voice_scoring(uuid, uuid, integer, text),
  public.fail_voice_scoring(uuid, uuid, text)
  to service_role;

commit;
notify pgrst, 'reload schema';
