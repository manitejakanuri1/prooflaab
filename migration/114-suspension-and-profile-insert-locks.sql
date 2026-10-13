-- 114: two locks from the 14 Oct security gate (Cloudflare audit run-1, P0). NOT APPLIED ANYWHERE.
-- Requires 100 (managed accounts only): the self-check below refuses to run while 100's three
-- self-service INSERT policies still exist. Staging first; owner's yes needed.
--
--   1. A college or company owner could lift its own suspension. Suspension is colleges.status /
--      startups.status = 'suspended' (admin screen CollegeOversight). colleges_own_update lets the owner
--      update its own row, and keep_approval_closed (84) froze only verification_status. Now status is
--      frozen the same way. Only admin screens write status; admins and the service role are unaffected.
--   2. Any login with no profile could INSERT its own student_profiles row naming ANY college (and any
--      total_xp), becoming a "managed" student of that college: web_login_identity then admits it, and
--      the college's roster and squad policies include it. protect_student_profiles guards UPDATE only.
--      Now a browser insert may not name a college and starts at 0 XP. The only browser insert
--      (src/lib/ensureStudentProfile.ts) sends neither; imports use the service role.
-- Nothing here rewrites or deletes existing rows.
-- Rollback: 114-rollback-suspension-and-profile-insert-locks.sql (84's body and stage 1's policy, verbatim).
begin;

-- 1 ---------------------------------------------------------------------------------------------------------------
-- 84's body, with one added line (marked 114).
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
      new.status := old.status;                     -- 114: suspension is set and lifted by an administrator only
    end if;
  end if;
  return new;
end $$;
revoke all on function public.keep_approval_closed() from public, anon, authenticated;

-- 2 ---------------------------------------------------------------------------------------------------------------
drop policy if exists student_profiles_own_insert on public.student_profiles;
create policy student_profiles_own_insert on public.student_profiles
  for insert to authenticated
  with check (
    (id = (select auth.uid()) and college_id is null and coalesce(total_xp, 0) = 0)
    or public.is_admin()
  );

do $$
declare
  d text := pg_get_functiondef('public.keep_approval_closed()'::regprocedure);
  w text;
begin
  if exists (select 1 from pg_policies where schemaname = 'public'
              and policyname in ('user_roles_self_claim', 'colleges_own_insert', 'startups_self_signup')) then
    raise exception '114 self-check: migration 100 is not in effect (a self-service insert policy still exists); apply 100 first';
  end if;
  if position('new.status := old.status' in d) = 0 or position('new.verification_status := old.verification_status' in d) = 0 then
    raise exception '114 self-check: keep_approval_closed does not freeze status and verification_status';
  end if;
  foreach w in array array['colleges', 'startups', 'recruiters'] loop
    if not exists (select 1 from pg_trigger where tgname = 'keep_approval_closed'
                    and tgrelid = format('public.%I', w)::regclass and not tgisinternal) then
      raise exception '114 self-check: keep_approval_closed trigger missing on %', w;
    end if;
  end loop;
  select with_check into w from pg_policies
   where schemaname = 'public' and tablename = 'student_profiles' and policyname = 'student_profiles_own_insert';
  if w is null or position('college_id IS NULL' in w) = 0 or position('total_xp' in w) = 0 then
    raise exception '114 self-check: student_profiles_own_insert was not replaced: %', w;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'student_profiles'
              and cmd in ('INSERT', 'ALL') and policyname <> 'student_profiles_own_insert'
              and coalesce(with_check, qual, '') !~ 'is_admin\s*\(') then
    raise exception '114 self-check: another student_profiles INSERT policy lets a non-administrator in';
  end if;
end $$;

commit;
