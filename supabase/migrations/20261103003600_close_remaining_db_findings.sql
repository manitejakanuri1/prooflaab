-- 86 (staging 5 Oct 2026): the last three findings of the staging database-security audit.
--
-- 1. MEDIUM. anon and authenticated held TRUNCATE, REFERENCES and TRIGGER on 76 of 83 public tables
--    (direct grants left by the old default privileges; not through PUBLIC, no role membership).
--    TRUNCATE ignores row-level security: a signed-in student emptied public.rate_limits inside a
--    rolled-back transaction. Nothing in the app needs these three rights. Revoked. SELECT / INSERT /
--    UPDATE / DELETE (governed by RLS) are untouched; service_role and postgres are untouched.
--    New tables are already closed by migration 83 (checked below).
--
-- 2. LOW. public.student_credits: a student could INSERT their own row with any values
--    (99,999 credits, premium = true; proven in a rolled-back transaction). protect_columns only
--    guards UPDATE. No browser, server or SQL code reads or writes this table. Credits are now
--    system-owned: the insert and update policies are dropped and INSERT / UPDATE / DELETE are
--    revoked from authenticated (anon loses everything). A student may still read their own row.
--    The backend (service_role) keeps full access.
--
-- 3. LOW. public.review_task_submission(uuid, boolean) answered "no such submission" or "not
--    awaiting review" BEFORE checking who was asking, so anyone (even anonymous, via a PUBLIC grant)
--    could probe a submission id. Now the caller is authorized first; an unauthorized caller always
--    gets {"ok": false, "reason": "forbidden"} whatever the submission's state or existence. Admins and
--    the approved owning college get exactly the old answers and the old review path (XP, completion,
--    activity, daily-Lot effects unchanged). Anonymous EXECUTE removed.
begin;

-- ---- 1. table rights nobody in the app needs -----------------------------------------------------
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- ---- 2. student_credits is system-owned ----------------------------------------------------------
drop policy if exists student_credits_own_insert on public.student_credits;
drop policy if exists student_credits_own_update on public.student_credits;
revoke all on public.student_credits from anon;
revoke insert, update, delete on public.student_credits from authenticated;

-- ---- 3. review_task_submission: authorize first ---------------------------------------------------
create or replace function public.review_task_submission(_submission_id uuid, _approve boolean)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  sub   record;
  t     record;
  n     integer;
  xp    integer := 0;
  prev  text;
  topic text;
  may_review boolean;
begin
  select * into sub from public.task_submissions where id = _submission_id;

  -- Who may review is decided before anything about the submission is said. A missing submission
  -- has no owning college, so only an admin can learn that it does not exist.
  select coalesce(public.is_admin(), false)
      or exists (
           select 1 from public.student_profiles sp
             join public.colleges c on c.id = sp.college_id
            where sp.id = sub.student_id
              and c.user_id = (select auth.uid())
              and c.verification_status = 'approved')
    into may_review;
  if not coalesce(may_review, false) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if sub.id is null then return jsonb_build_object('ok', false, 'reason', 'no such submission'); end if;
  if sub.status <> 'needs_review' then
    return jsonb_build_object('ok', false, 'reason', 'not awaiting review');
  end if;

  if not _approve then
    update public.task_submissions set status = 'failed' where id = _submission_id;
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;

  select id, student_id, xp_reward, source, level_id into t from public.tasks where id = sub.task_id;
  if t.level_id is not null then
    select skill into topic from public.levels where id = t.level_id;
  end if;

  update public.task_submissions set status = 'passed' where id = _submission_id;

  prev := current_setting('app.system_write', true);
  perform set_config('app.system_write', 'on', true);

  if t.student_id = sub.student_id then
    update public.tasks set status = 'completed', completed_at = now() where id = t.id;
  else
    update public.task_assignments
       set status = 'completed', completed_at = now(), submitted_at = now()
     where task_id = t.id and student_id = sub.student_id;
  end if;

  if coalesce(t.xp_reward, 0) > 0 then
    insert into public.xp_logs (student_id, xp_points, source)
    values (sub.student_id, t.xp_reward, 'task:' || t.id)
    on conflict (student_id, source) where source like 'task:%' do nothing;
    get diagnostics n = row_count;
    if n > 0 then
      update public.student_profiles set total_xp = coalesce(total_xp, 0) + t.xp_reward
       where id = sub.student_id;
      xp := t.xp_reward;
      update public.task_submissions set xp_awarded = xp where id = _submission_id;
    end if;
  end if;

  perform set_config('app.system_write', coalesce(prev, ''), true);

  perform public.log_activity(sub.student_id, 'task_completed', 'task_submissions', sub.id,
                              jsonb_build_object('task_id', t.id, 'kind', 'rubric', 'reviewed', true));
  perform public.record_activity(sub.student_id, 'task_completed');

  if t.source = 'daily_lot' then
    perform public.record_activity(sub.student_id, 'lot_submitted');
    if topic is not null then
      perform public.record_topic_attempt(sub.student_id, topic, 'correct', t.level_id, null);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'status', 'passed', 'xp_awarded', xp);
end $function$;

revoke all on function public.review_task_submission(uuid, boolean) from public, anon;
grant execute on function public.review_task_submission(uuid, boolean) to authenticated, service_role;

-- ---- self-checks -------------------------------------------------------------------------------
do $$
declare
  bad text; stu uuid; foreign_sub uuid; adm uuid; got text; got_admin text; ins text; svc text;
begin
  -- 1. effective rights, every public table
  select string_agg(format('%s:%s:%s', r, p, c.relname), ', ') into bad
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace,
         unnest(array['anon', 'authenticated']) r, unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER']) p
   where ns.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege(r, c.oid, p);
  if bad is not null then raise exception '86: anon/authenticated still hold: %', left(bad, 400); end if;
  -- the backend keeps what it had for normal work
  if exists (select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
              where ns.nspname = 'public' and c.relname in ('tasks', 'task_submissions', 'student_profiles', 'student_credits')
                and not has_table_privilege('service_role', c.oid, 'select,insert,update,delete')) then
    raise exception '86: service_role lost normal access to a core table';
  end if;
  -- future tables stay closed (migration 83)
  if exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
              where d.defaclobjtype = 'r' and pg_get_userbyid(d.defaclrole) = 'postgres'
                and a.grantee in ('anon'::regrole, 'authenticated'::regrole)) then
    raise exception '86: default privileges again give new tables to anon/authenticated';
  end if;

  -- 2. student_credits
  if has_table_privilege('authenticated', 'public.student_credits', 'insert,update,delete')
     or has_table_privilege('anon', 'public.student_credits', 'select,insert,update,delete')
     or not has_table_privilege('authenticated', 'public.student_credits', 'select')
     or not has_table_privilege('service_role', 'public.student_credits', 'select,insert,update,delete')
     or exists (select 1 from pg_policy where polrelid = 'public.student_credits'::regclass and polcmd in ('a', 'w', 'd', '*')) then
    raise exception '86: student_credits is not system-owned';
  end if;

  select sp.id into stu from public.student_profiles sp
   where sp.user_id = sp.id
     and not exists (select 1 from public.user_roles ur where ur.user_id = sp.id and ur.role = 'admin')
     and not exists (select 1 from public.student_credits sc where sc.student_id = sp.id)
   limit 1;
  begin
    if stu is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      begin
        insert into public.student_credits (student_id, credits_available, credits_used_today, premium_status) values (stu, 99999, 0, true);
        ins := 'ALLOWED';
      exception when insufficient_privilege then ins := 'denied';
      end;
      execute 'reset role';
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
      execute 'set local role service_role';
      insert into public.student_credits (student_id, credits_available, credits_used_today, premium_status) values (stu, 5, 0, false);
      update public.student_credits set credits_available = 6 where student_id = stu;
      svc := (select credits_available::text from public.student_credits where student_id = stu);
      execute 'reset role';
    end if;
    raise exception 'probe86_rollback';
  exception when raise_exception then
    if sqlerrm <> 'probe86_rollback' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  if ins = 'ALLOWED' then raise exception '86: a student can still create their own credits row'; end if;
  if stu is not null and svc is distinct from '6' then raise exception '86: the backend can no longer write credits (%)', svc; end if;

  -- 3. review_task_submission: an unrelated student gets "forbidden" for a submission that is not
  --    awaiting review; an admin gets the real answer.
  select s.id into foreign_sub from public.task_submissions s
   where s.status <> 'needs_review' and s.student_id <> stu limit 1;
  select ur.user_id into adm from public.user_roles ur where ur.role = 'admin' limit 1;
  if has_function_privilege('anon', 'public.review_task_submission(uuid,boolean)', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                 where p.oid = 'public.review_task_submission(uuid,boolean)'::regprocedure and a.grantee = 0) then
    raise exception '86: review_task_submission is still callable without signing in';
  end if;
  if foreign_sub is not null and stu is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    got := public.review_task_submission(foreign_sub, false) ->> 'reason';
    perform set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
    if public.review_task_submission(gen_random_uuid(), false) ->> 'reason' <> 'forbidden' then
      raise exception '86: an unrelated student can tell a missing submission apart';
    end if;
    if adm is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
      got_admin := public.review_task_submission(foreign_sub, false) ->> 'reason';
    end if;
    perform set_config('request.jwt.claims', '', true);
    if got is distinct from 'forbidden' then raise exception '86: an unrelated student still learns "%"', got; end if;
    if adm is not null and got_admin is distinct from 'not awaiting review' then
      raise exception '86: the admin no longer gets the real answer (%)', got_admin;
    end if;
  end if;
  raise notice '86 self-check: rights closed; credits student insert=%, backend=%; review: student=%, admin=%', ins, svc, got, got_admin;
end $$;

commit;
notify pgrst, 'reload schema';
