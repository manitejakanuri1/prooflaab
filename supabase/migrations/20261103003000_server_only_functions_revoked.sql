-- 80: server-only database functions can be run by the backend (service_role) only.
-- On staging (4 Oct) these functions had no ACL of their own, so PUBLIC - and through it anon and
-- authenticated - could EXECUTE them through the API. record_task_submission, for one, writes a
-- grade and has no caller check inside. The migrations that created them revoke anon/authenticated
-- (stage 31, 55, 69/70, 70b, 88, server_rpc_grants, ...); staging's privileges had drifted from that.
-- Every function here is called only by a server with the service key (traced in
-- scripts/dev-tools/rpc_caller_audit.py) and never by the browser.
-- Functions that only other SQL calls (season engine, Lot claiming, has_role, ...) are NOT touched
-- here: some may be used inside policies, so they are reviewed separately.
-- (78 is reserved for the pending coding-verification change.)
begin;

create temp table d1_server_only (sig regprocedure) on commit drop;
insert into d1_server_only values
  ('public.account_id_for_email(text)'),
  ('public.bump_llm_cache_hit(text)'),
  ('public.check_rate_limit(text,text,integer,integer)'),
  ('public.drop_empty_account(uuid)'),
  ('public.ensure_and_claim_lot_template(uuid)'),
  ('public.extend_all_fixtures()'),
  ('public.form_all_colleges()'),
  ('public.form_squads(uuid,uuid)'),
  ('public.log_security_event(text,text,text,uuid,text,text,text,jsonb)'),
  ('public.notify_weekly_progress()'),
  ('public.plan_all_weeks()'),
  ('public.prune_app_events()'),
  ('public.record_account(text,text,text,boolean)'),
  ('public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'),
  ('public.record_topic_attempt(uuid,text,text,uuid,integer)'),
  ('public.release_lot_template(uuid,uuid)'),
  ('public.remove_students(uuid[],uuid,text)'),
  ('public.resolve_account(text,text,boolean)'),
  ('public.run_all_seasons()'),
  ('public.save_lot_template(uuid,uuid,text,text,text,text,text,integer,text)'),
  ('public.save_lot_template(uuid,uuid,text,text,text,text,text,integer,text,uuid,uuid)'),
  ('public.similar_written_submission(uuid,uuid,text,real)'),
  ('public.student_logins()'),
  ('public.touch_lot_template(uuid,uuid)'),
  ('public.touch_streak(uuid)'),
  ('public.touch_template(text)');

do $$
declare f regprocedure;
begin
  for f in select sig from d1_server_only loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$
declare f regprocedure; bad text := '';
begin
  for f in select sig from d1_server_only loop
    if has_function_privilege('anon', f, 'execute') then bad := bad || format(' %s:anon', f); end if;
    if has_function_privilege('authenticated', f, 'execute') then bad := bad || format(' %s:authenticated', f); end if;
    if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0) then bad := bad || format(' %s:PUBLIC', f); end if;
    if not has_function_privilege('service_role', f, 'execute') then bad := bad || format(' %s:service_role-missing', f); end if;
  end loop;
  if bad <> '' then raise exception '80 self-check failed:%', bad; end if;
  if (select count(*) from d1_server_only) <> 26 then raise exception '80 self-check: expected 26 signatures'; end if;
end $$;

commit;
notify pgrst, 'reload schema';
