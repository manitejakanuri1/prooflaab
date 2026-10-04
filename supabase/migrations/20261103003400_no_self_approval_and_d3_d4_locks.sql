-- 84 (D3 + D4, staging 5 Oct 2026).
--
-- 1. HIGH: self-approval. RLS lets a signed-in user insert their own recruiters / startups / colleges
--    row and update it, but nothing stopped them choosing the approval columns. Proven on staging in
--    rolled-back transactions: a STUDENT could create a verified recruiter (is_verified_recruiter() =
--    true, which opens recruiter_talent / recruiter_proof_profile, incl. student contact details), an
--    approved company (my_company_ok() = true) and an approved college (my_college_id() set); an
--    unverified recruiter could set verified = true and a pending college could set itself approved.
--    Fix: a BEFORE trigger keeps the approval columns closed for every caller except the backend
--    (service_role) and an admin. Sign-up still works: the browser inserts these rows as 'pending'.
--    Approval still works: admins (Admin > People) and admin_verify_recruiter() are admins.
--
-- 2. D3: admin_users (a view over user_roles + auth.users, owner postgres, filtered by is_admin()).
--    Proven safe in behaviour (non-admins see 0 rows; writes go through admin_users_write(), which
--    refuses non-admins; DELETE is not supported), but it carried full grants to anon. Now: anon has
--    nothing; authenticated keeps only SELECT / INSERT / UPDATE (the admin screen uses exactly those);
--    security_barrier keeps the is_admin() filter evaluated before any caller-supplied filter.
--
-- 3. D4: direct API access removed from
--    - three unused functions that were unsafe to call directly:
--        placement_questions(uuid)            trusted a caller-supplied student id (read another
--                                             student's tracks; returned quiz content to anonymous)
--        squad_championship_achievements(uuid) no caller check (any squad, any college, anonymous)
--        submit_placement(jsonb)              let a student write their own topic ratings from
--                                             client-supplied results
--    - ten security-invoker SQL helpers that only security-definer functions call
--      (season engine, squad_town, unlock_ceiling, is_last_step).
--    Revoked from PUBLIC / anon / authenticated, granted to service_role.
begin;

-- ---- 1. no self-approval -----------------------------------------------------------------------
create or replace function public.keep_approval_closed()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  raw  text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_role text;
begin
  if raw is null then
    return new;                                   -- direct database access (migrations, operators)
  end if;
  begin
    jwt_role := raw::jsonb ->> 'role';
  exception when others then
    jwt_role := null;                               -- unreadable token: treat as an ordinary caller
  end;
  if jwt_role = 'service_role' or public.is_admin() then
    return new;
  end if;

  if tg_table_name = 'recruiters' then
    if tg_op = 'INSERT' then
      new.verified := false; new.verified_at := null; new.verified_by := null;
    else
      new.verified := old.verified; new.verified_at := old.verified_at; new.verified_by := old.verified_by;
    end if;
  else                                            -- colleges, startups
    if tg_op = 'INSERT' then
      new.verification_status := 'pending';
    else
      new.verification_status := old.verification_status;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.keep_approval_closed() from public, anon, authenticated;

drop trigger if exists keep_approval_closed on public.recruiters;
create trigger keep_approval_closed before insert or update on public.recruiters
  for each row execute function public.keep_approval_closed();
drop trigger if exists keep_approval_closed on public.startups;
create trigger keep_approval_closed before insert or update on public.startups
  for each row execute function public.keep_approval_closed();
drop trigger if exists keep_approval_closed on public.colleges;
create trigger keep_approval_closed before insert or update on public.colleges
  for each row execute function public.keep_approval_closed();

-- ---- 2. D3 admin_users -------------------------------------------------------------------------
revoke all on public.admin_users from public, anon;
revoke all on public.admin_users from authenticated;
grant select, insert, update on public.admin_users to authenticated;
alter view public.admin_users set (security_barrier = true);

-- ---- 3. D4 function locks ----------------------------------------------------------------------
create temp table d4_locked(sig regprocedure) on commit drop;
insert into d4_locked values
  ('public.placement_questions(uuid)'), ('public.squad_championship_achievements(uuid)'), ('public.submit_placement(jsonb)'),
  ('public.head_to_head(uuid,uuid,uuid)'), ('public.is_last_step(uuid)'), ('public.season_league_last_week(uuid)'),
  ('public.season_phase(uuid,integer)'), ('public.season_plan(uuid)'), ('public.season_week(uuid)'),
  ('public.season_week_bounds(uuid,integer)'), ('public.season_week_start(uuid,integer)'), ('public.squad_town(uuid)'),
  ('public.unlock_ceiling(uuid,text)');

-- Refuse if anything that runs with the CALLER's rights still calls them (it would break).
do $$
declare bad text;
begin
  select string_agg(distinct p.oid::regprocedure::text || ' -> ' || l.sig::text, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace, d4_locked l
   where n.nspname = 'public' and not p.prosecdef and p.prorettype <> 'trigger'::regtype
     and p.oid not in (select sig from d4_locked)
     and p.prosrc ~ ('\m' || (select proname from pg_proc where oid = l.sig) || '\s*\(');
  if bad is not null then raise exception '84 pre-check: invoker functions still call these: %', bad; end if;
  select string_agg(distinct pol.polname, ', ') into bad from pg_policy pol, d4_locked l
   where coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')
         ~ ('\m' || (select proname from pg_proc where oid = l.sig) || '\s*\(');
  if bad is not null then raise exception '84 pre-check: policies use these: %', bad; end if;
end $$;

do $$
declare f regprocedure;
begin
  for f in select sig from d4_locked loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---- self-checks -------------------------------------------------------------------------------
do $$
declare
  stu uuid; rec uuid; col uuid;
  v_rec boolean; v_sta boolean; v_col uuid; v_recupd boolean; v_colupd text;
begin
  -- grants
  if has_table_privilege('anon', 'public.admin_users', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.admin_users', 'delete,truncate') then
    raise exception '84: admin_users grants still too wide';
  end if;
  if exists (select 1 from pg_class where oid = 'public.admin_users'::regclass and not ('security_barrier=true' = any(coalesce(reloptions, '{}')))) then
    raise exception '84: admin_users is not a security barrier';
  end if;
  if exists (select 1 from d4_locked l where has_function_privilege('anon', l.sig, 'execute') or has_function_privilege('authenticated', l.sig, 'execute')
             or not has_function_privilege('service_role', l.sig, 'execute')
             or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = l.sig and a.grantee = 0)) then
    raise exception '84: a locked function is still callable by PUBLIC/anon/authenticated (or lost service_role)';
  end if;

  -- behaviour, inside a block that is always rolled back
  select sp.id into stu from public.student_profiles sp
   where sp.user_id = sp.id
     and not exists (select 1 from public.recruiters r where r.id = sp.id)
     and not exists (select 1 from public.startups s where s.user_id = sp.id)
     and not exists (select 1 from public.colleges c where c.user_id = sp.id)
     and not exists (select 1 from public.user_roles ur where ur.user_id = sp.id and ur.role = 'admin')
   limit 1;
  select r.id into rec from public.recruiters r
   where not exists (select 1 from public.user_roles ur where ur.user_id = r.id and ur.role = 'admin') limit 1;
  select c.user_id into col from public.colleges c
   where not exists (select 1 from public.user_roles ur where ur.user_id = c.user_id and ur.role = 'admin') limit 1;
  begin
    if stu is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', stu, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into public.recruiters (id, company, contact_name, work_email, verified) values (stu, '84 probe', '84 probe', 'probe84@example.invalid', true);
      v_rec := public.is_verified_recruiter();
      insert into public.startups (user_id, name, email, verification_status, status) values (stu, '84 probe', 'probe84@example.invalid', 'approved', 'active');
      v_sta := public.my_company_ok();
      insert into public.colleges (user_id, name, email, verification_status, status) values (stu, '84 probe', 'probe84@example.invalid', 'approved', 'active');
      v_col := public.my_college_id();
      execute 'reset role';
    end if;
    if rec is not null then
      perform set_config('request.jwt.claims', '', true);
      update public.recruiters set verified = false where id = rec;          -- as owner, to have a pending one
      perform set_config('request.jwt.claims', json_build_object('sub', rec, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      update public.recruiters set verified = true where id = rec;
      v_recupd := (select verified from public.recruiters where id = rec);
      execute 'reset role';
    end if;
    if col is not null then
      perform set_config('request.jwt.claims', '', true);
      update public.colleges set verification_status = 'pending' where user_id = col;
      perform set_config('request.jwt.claims', json_build_object('sub', col, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      update public.colleges set verification_status = 'approved' where user_id = col;
      execute 'reset role';
      v_colupd := (select verification_status from public.colleges where user_id = col);
    end if;
    raise exception 'probe84_rollback';
  exception when raise_exception then
    if sqlerrm <> 'probe84_rollback' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  if v_rec or v_sta or v_col is not null then
    raise exception '84: a student could still create an approved recruiter/company/college (%, %, %)', v_rec, v_sta, v_col;
  end if;
  if v_recupd then raise exception '84: a recruiter could still verify itself'; end if;
  if v_colupd = 'approved' then raise exception '84: a college could still approve itself'; end if;
  raise notice '84 self-check: student probe=%, recruiter probe=%, college probe=% all refused', stu is not null, rec is not null, col is not null;
end $$;

commit;
notify pgrst, 'reload schema';
