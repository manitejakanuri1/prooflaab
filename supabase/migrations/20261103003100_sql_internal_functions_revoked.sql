-- 81 (D1b): SQL-internal database functions can no longer be called directly through the API.
-- On staging (4 Oct) anon and authenticated could run these through PostgREST; a probe with random ids
-- reached the body of every one (season engine, Lot creation, has_role, ...). Their creating migrations
-- revoke them; staging's privileges had drifted.
-- Proven before revoking (scripts/dev-tools/rpc_caller_audit.py + pg_policy/pg_views/pg_proc on staging):
--   * no browser or server code calls them by name (one test script calls next_lot_source with the
--     service key, so service_role keeps EXECUTE on all of them);
--   * no RLS policy or view uses them;
--   * every function that calls them is SECURITY DEFINER, so the nested call runs as the owner and
--     keeps working after the revoke.
-- Not touched: policy helpers (is_admin, viewer_college_id, ...), the pre-request hook
-- refuse_suspended, admin functions with their own is_admin() guard, and user functions granted on
-- purpose (two of those, topic_priorities and notify_all_admins, are flagged for the owner separately).
begin;

create temp table d1b_sql_internal (sig regprocedure) on commit drop;
insert into d1b_sql_internal values
  ('public.advance_season(uuid)'), ('public.backfill_rounds(uuid)'), ('public.claim_lot_template(uuid)'),
  ('public.close_season(uuid)'), ('public.create_lot_for(uuid,date)'), ('public.ensure_season(uuid)'),
  ('public.extend_fixtures(uuid)'), ('public.generate_championship(uuid)'), ('public.generate_cohort_league(uuid,boolean)'),
  ('public.generate_final(uuid)'), ('public.generate_knockout(uuid)'), ('public.generate_round_robin(uuid,boolean,integer)'),
  ('public.has_role(uuid,app_role)'), ('public.is_duplicate_source(text,text,bigint,real)'),
  ('public.log_activity(uuid,text,text,uuid,jsonb)'), ('public.lot_needs_writer(uuid)'), ('public.next_lot_source(uuid)'),
  ('public.notify_retest_unlocks()'), ('public.plan_student_week(uuid,date)'), ('public.prune_bug_finder_runs()'),
  ('public.prune_rate_limits()'), ('public.qualify_squads(uuid)'), ('public.record_activity(uuid,text)'),
  ('public.recount_season(uuid)'), ('public.refresh_unlock(uuid,text)'), ('public.reshuffle_quiz_options()'),
  ('public.resolve_account_uuid(text,text)'), ('public.run_squad_week(uuid,integer)'),
  ('public.schedule_round_robin(uuid,uuid[],integer,integer,text,text)'), ('public.score_student_week(uuid,uuid,integer)'),
  ('public.seed_championship(uuid)'), ('public.seed_lot_template(uuid)'), ('public.settle_round(uuid,integer)'),
  ('public.suggest_tracks(uuid,integer)'), ('public.write_audit(text,text,uuid,jsonb,jsonb,uuid)');

-- Refuse to proceed if anything now depends on calling one of them with the caller's own rights.
do $$
declare bad text;
begin
  select string_agg(distinct d.sig::text || ' <- ' || q.proname, ', ') into bad
    from d1b_sql_internal d
    join pg_proc f on f.oid = d.sig
    join pg_proc q on q.oid <> f.oid and not q.prosecdef and q.prosrc ~ ('\m' || f.proname || '\(')
    join pg_namespace qn on qn.oid = q.pronamespace and qn.nspname = 'public';
  if bad is not null then raise exception '81 precheck: called by a non-security-definer function: %', bad; end if;
  select string_agg(distinct d.sig::text, ', ') into bad
    from d1b_sql_internal d join pg_proc f on f.oid = d.sig
   where exists (select 1 from pg_policy pol where pg_get_expr(pol.polqual, pol.polrelid) ~ ('\m' || f.proname || '\(')
                    or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~ ('\m' || f.proname || '\('))
      or exists (select 1 from pg_views v where v.schemaname = 'public' and v.definition ~ ('\m' || f.proname || '\('));
  if bad is not null then raise exception '81 precheck: used by a policy or view: %', bad; end if;
end $$;

do $$
declare f regprocedure;
begin
  for f in select sig from d1b_sql_internal loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$
declare f regprocedure; bad text := '';
begin
  for f in select sig from d1b_sql_internal loop
    if has_function_privilege('anon', f, 'execute') then bad := bad || format(' %s:anon', f); end if;
    if has_function_privilege('authenticated', f, 'execute') then bad := bad || format(' %s:authenticated', f); end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0) then bad := bad || format(' %s:PUBLIC', f); end if;
    if not has_function_privilege('service_role', f, 'execute') then bad := bad || format(' %s:service_role-missing', f); end if;
  end loop;
  if bad <> '' then raise exception '81 self-check failed:%', bad; end if;
  if (select count(*) from d1b_sql_internal) <> 35 then raise exception '81 self-check: expected 35 signatures'; end if;
  -- The policy helper that calls has_role must still work for a signed-in user.
  if not has_function_privilege('authenticated', 'public.is_admin()', 'execute') then raise exception '81 self-check: is_admin() lost authenticated execute'; end if;
end $$;

commit;
notify pgrst, 'reload schema';
