-- Removes the ProofLab QA Demo college and everything tied to it, then proves it against the fingerprint from setup.
-- qa.mode = 'dry': does the whole removal, writes the report, then undoes the removal. 'delete': keeps the removal.
-- Any failure, or any demo trace left over: everything is undone and the report says FAILED.
select set_config('app.system_write', 'on', true);
do $c$
declare
  mode text := current_setting('qa.mode');
  cid uuid; demo_uids uuid[]; ids uuid[]; re text;
  out text[] := '{}';
  t record; cnt bigint; gone bigint; added bigint; check_n integer := 0; left_n integer := 0;
  -- Tables the website or nightly jobs write to all the time, with or without the demo.
  sys text[] := array['public.app_events', 'public.audit_logs', 'public.rate_limits', 'public.web_sessions', 'public.llm_usage',
                      'public.security_events', 'public.bug_finder_runs', 'public.notifications', 'public.student_activity_events'];
begin
  begin
    select id into cid from public.colleges where email = 'college@qa-demo.prooflab.invalid' and name = 'ProofLab QA Demo';
    insert into qa_demo.users (id, email)
      select u.id, u.email from auth.users u
       where u.email like '%@qa-demo.prooflab.invalid'
          or u.id in (select p.id from public.student_profiles p where p.college_id = cid)
    on conflict (id) do nothing;
    select coalesce(array_agg(id), '{}') into demo_uids from qa_demo.users;
    ids := demo_uids || coalesce(array[cid], '{}')
        || coalesce((select array_agg(id) from public.seasons where college_id = cid), '{}')
        || coalesce((select array_agg(id) from public.squads where college_id = cid), '{}')
        || coalesce((select array_agg(id) from public.startups where user_id = any(demo_uids)), '{}');
    re := array_to_string(ids::text[] || array['qa-demo\.prooflab\.invalid', 'ProofLab QA Demo'], '|');

    out := out || array(select 'LOGIN: ' || id || ' ' || email from qa_demo.users order by email);

    truncate qa_demo.counts_before;
    for t in select schemaname s, tablename r from pg_tables where schemaname in ('public', 'auth') loop
      execute format('select count(*) from %I.%I', t.s, t.r) into cnt;
      insert into qa_demo.counts_before values (t.s || '.' || t.r, cnt);
    end loop;

    -- Season side first: these links block deleting a squad.
    delete from public.season_champions where season_id in (select id from public.seasons where college_id = cid);
    update public.seasons set champion_squad_id = null, runner_up_squad_id = null, third_squad_id = null where college_id = cid;
    delete from public.tasks where student_id = any(demo_uids) or created_by_startup_id = any(demo_uids)
                                or created_by_admin_id = any(demo_uids) or created_by_college_id = cid;
    delete from public.daily_marks where student_id = any(demo_uids) or season_id in (select id from public.seasons where college_id = cid);
    delete from public.student_weekly_scores where student_id = any(demo_uids);
    delete from public.squads where college_id = cid;
    delete from public.seasons where college_id = cid;
    delete from public.job_opportunities where created_by = any(demo_uids);
    delete from public.student_import_rows where student_id = any(demo_uids);
    delete from public.task_rubric_config where created_by = any(demo_uids);
    delete from public.task_sandbox_config where created_by = any(demo_uids);
    delete from public.task_templates where created_by = any(demo_uids);
    -- Logins next: student, college and company records follow through the database's own cascades.
    delete from public.account_identities where user_id = any(demo_uids);
    delete from public.student_intake where user_id = any(demo_uids);
    delete from public.web_sessions where user_id = any(demo_uids);
    delete from public.user_roles where user_id = any(demo_uids);
    delete from public.identity_lifecycle where user_id = any(demo_uids);
    delete from auth.users where id = any(demo_uids);
    delete from public.colleges where id = cid;
    -- Log rows that name a demo id or the demo college.
    delete from public.audit_logs x where x::text ~ re;
    delete from public.llm_usage x where x::text ~ re;
    delete from public.notifications x where x::text ~ re;
    delete from public.security_events x where x::text ~ re;
    delete from public.student_activity_events x where x::text ~ re;
    delete from public.removed_students x where x::text ~ re;

    -- Proof 1: what was removed, table by table.
    for t in select schemaname s, tablename r from pg_tables where schemaname in ('public', 'auth') order by 1, 2 loop
      execute format('select count(*) from %I.%I', t.s, t.r) into cnt;
      select b.n - cnt into gone from qa_demo.counts_before b where b.tbl = t.s || '.' || t.r;
      if gone <> 0 then out := out || ('REMOVED: ' || t.s || '.' || t.r || ' ' || gone); end if;
    end loop;

    -- Proof 2: no demo id, email or college name is left in any row of any table.
    for t in select schemaname s, tablename r from pg_tables where schemaname in ('public', 'auth') loop
      execute format('select count(*) from %I.%I x where x::text ~ %L', t.s, t.r, re) into cnt;
      if cnt > 0 then out := out || ('LEFT: ' || t.s || '.' || t.r || ' ' || cnt); left_n := left_n + 1; end if;
    end loop;
    if left_n > 0 then raise exception 'QA_LEFT'; end if;

    -- Proof 3: every row that existed before the demo is still there, unchanged. A changed row shows as "changed".
    for t in select distinct tbl from qa_demo.baseline where tbl not like '=%' order by 1 loop
      execute format($q$select count(*) from qa_demo.baseline b where b.tbl = %L
                         and not exists (select 1 from %s x where md5(x::text) = b.h)$q$, t.tbl, t.tbl) into gone;
      execute format($q$select count(*) from %s x where not exists
                         (select 1 from qa_demo.baseline b where b.tbl = %L and b.h = md5(x::text))$q$, t.tbl, t.tbl) into added;
      if gone > 0 or added > 0 then
        if t.tbl = any(sys) then
          out := out || ('SYSTEM_LOG: ' || t.tbl || ' changed ' || gone || ', new ' || added);
        else
          out := out || ('CHECK: ' || t.tbl || ' changed ' || gone || ', new ' || added);
          check_n := check_n + 1;
        end if;
      end if;
    end loop;

    -- Proof 4: permissions are exactly as before the demo.
    with now_p as (
      select '=policies' k, md5(p::text) h from pg_policies p where schemaname in ('public', 'auth')
      union all select '=table_grants', md5(g::text) from information_schema.role_table_grants g where table_schema in ('public', 'auth')
      union all select '=functions', md5(p.oid::regprocedure::text || p.prosrc || coalesce(p.proacl::text, '') || p.proowner::text)
                  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'auth'::regnamespace)
      union all select '=roles', md5(r.rolname || r.rolsuper || r.rolbypassrls || r.rolcanlogin) from pg_roles r)
    select count(*) into cnt from (
      (select k, h from now_p except select tbl, h from qa_demo.baseline where tbl like '=%')
      union all
      (select tbl, h from qa_demo.baseline where tbl like '=%' except select k, h from now_p)) d;
    out := out || ('PERMISSIONS: ' || case when cnt = 0 then 'exactly as before the demo' else 'DIFFERENT in ' || cnt || ' places' end);
    if cnt > 0 then check_n := check_n + 1; end if;

    out := out || ('RESULT: ' || case when check_n = 0 then 'PASS - only demo data removed, nothing else changed'
                                      else 'LOOK - ' || check_n || ' item(s) marked CHECK changed since setup. Ask Claude what they are.' end);
    if mode <> 'delete' then raise exception 'QA_DRY'; end if;
  exception when others then
    if sqlerrm = 'QA_DRY' then
      out := out || 'MODE: trial only. Nothing was removed.'::text;
    elsif sqlerrm = 'QA_LEFT' then
      out := out || 'FAILED: demo traces would be left in the LEFT tables. Nothing was removed.'::text;
    else
      out := out || ('FAILED: ' || sqlerrm || '. Nothing was removed.');
    end if;
  end;
  delete from qa_demo.report;
  insert into qa_demo.report (line) select unnest(out);
end $c$;
