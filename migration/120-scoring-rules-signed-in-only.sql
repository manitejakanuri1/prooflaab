-- 120: the squad points table is for signed-in users only.
--
-- tpo_scoring_rules() returned the 6 platform scoring rules to a signed-out
-- caller (S40 BASELINE, staging, 19 Oct 2026: "returned 6 row(s) to an anonymous
-- caller"). Stage 46 (20260918000000) revoked anon execute on these functions in
-- the old Supabase database; on Cloud SQL they still carry the default PUBLIC
-- grant plus anon. Before 117 staging had no default rules, so the call returned
-- an empty list and the check passed.
--
-- Not private data (labels and points), but signed-out callers get nothing.
-- The two write functions already refuse anon (my_college_id() is null) and are
-- closed the same way. The college screen (TpoSquads) calls them signed in.
begin;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('tpo_scoring_rules', 'tpo_set_scoring_weight', 'tpo_reset_scoring_weight')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

-- Self-check: anon cannot run them, signed-in users still can.
do $$
declare r record;
begin
  for r in
    select p.oid, p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('tpo_scoring_rules', 'tpo_set_scoring_weight', 'tpo_reset_scoring_weight')
  loop
    if has_function_privilege('anon', r.oid, 'execute') then
      raise exception '120 self-check: anon can still run %', r.proname;
    end if;
    if not has_function_privilege('authenticated', r.oid, 'execute') then
      raise exception '120 self-check: signed-in users lost %', r.proname;
    end if;
  end loop;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tpo_scoring_rules') then
    raise exception '120 self-check: tpo_scoring_rules not found';
  end if;
  raise notice '120 self-check passed';
end $$;

commit;
notify pgrst, 'reload schema';
