-- Rollback of the TEST-only Step 6DD catch-up: puts back TEST's unfixed definitions. TEST ONLY.
begin;
do $$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') then raise exception 'TEST only'; end if; end $$;
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
   where id = _id and scoring_lease_token = _lease_token;
  get diagnostics n = row_count;
  return n > 0;
end $function$;

commit;
