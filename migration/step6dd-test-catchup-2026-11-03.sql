-- Step 6DD catch-up, TEST ONLY (owner OK 3 Nov 2026). REAL got the Step 6DD fixes to migration 45 on
-- 28 Sep 2026 (migration/step6dd-migration-45-production-execution.sql); TEST ran the original, unfixed 45.
-- go11 (3 Nov 2026) showed two functions still differ. This copies REAL's exact definitions to TEST:
--   claim_voice_scoring: a null, zero or negative TTL is refused (no takeover of a live claim)
--   fail_voice_scoring:  never turns a saved score into a failure (status <> 'scored')
-- Same name, arguments and return type, so CREATE OR REPLACE keeps every grant as it is.
-- Rollback: migration/step6dd-test-catchup-rollback-2026-11-03.sql (the TEST definitions before this change).
begin;
do $$ begin
  if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then
    raise exception 'TEST only - REAL already has these fixes';
  end if;
end $$;
CREATE OR REPLACE FUNCTION public.claim_voice_scoring(_id uuid, _claim_ttl_seconds integer DEFAULT 120)
 RETURNS TABLE(claimed boolean, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  _lease uuid := gen_random_uuid();
  n integer;
begin
  -- Step 6DD fix: a null, zero or negative TTL made every existing claim
  -- look stale at once, so any caller could take over a live claim.
  if _claim_ttl_seconds is null or _claim_ttl_seconds < 1 then
    raise exception 'claim_voice_scoring: _claim_ttl_seconds must be >= 1 (got %)', _claim_ttl_seconds;
  end if;
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

CREATE OR REPLACE FUNCTION public.fail_voice_scoring(_id uuid, _lease_token uuid, _notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer;
begin
  update public.voice_explanations
     set status = 'failed',
         communication_notes = coalesce(_notes, communication_notes),
         scoring_claimed_at = null,
         scoring_lease_token = null
   where id = _id and scoring_lease_token = _lease_token
     and status <> 'scored';  -- Step 6DD fix: never turn a saved score into a failure
  get diagnostics n = row_count;
  return n > 0;
end $function$;

do $$ begin
  if (select prosrc from pg_proc where proname = 'claim_voice_scoring') not like '%_claim_ttl_seconds < 1%' then
    raise exception 'self-check: claim_voice_scoring fix missing'; end if;
  if (select prosrc from pg_proc where proname = 'fail_voice_scoring') not like '%status <> ''scored''%' then
    raise exception 'self-check: fail_voice_scoring fix missing'; end if;
end $$;
commit;
