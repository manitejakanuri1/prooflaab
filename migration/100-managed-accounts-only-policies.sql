-- 100: accounts are created by an administrator or a college, never by the browser.
--
-- NOT APPLIED ANYWHERE. Review separately; staging first; owner's yes needed.
-- Numbered 100, not 99: 99 (and mirror 20261103004900) is held by the parked, uncommitted college
-- self-registration work in another worktree. The two must never share a ledger number.
--
-- Confirmed on STAGING, 8 Oct 2026 (read-only, by TEJA): all three policies below are ACTIVE, row-level
-- security is ON for user_roles, colleges and startups, and the ledger records 95, 96, 97, 98 (99 is
-- not recorded). So this is a live gap on staging, not only a reading of old files. Production: not read.
-- Read-only preflight in the form this file's self-check uses: scripts/dev-tools/managed_accounts_preflight.sql
-- (section 2 names any OTHER insert policy that would make the self-check refuse - resolve it first).
--
-- Three row-level-security policies were written for the old public sign-up form, which
-- wrote the chosen role and the organisation row straight from the browser:
--
--   user_roles_self_claim  (stage 1, widened in stage 47)
--       any signed-in login may INSERT its own role: student, college_admin, startup, recruiter
--   colleges_own_insert    (stage 1)
--       any signed-in login may INSERT a college row for itself
--   startups_self_signup   (stage 14)
--       any signed-in login may INSERT a company row for itself
--
-- Public sign-up was closed in the web BFF (/api/auth/signup answers 403) and the form no
-- longer has a sign-up branch, but these policies stayed. A Google Identity login that has no
-- role here (staging and production share one login pool) can still obtain a database token
-- from the auth bridge and then give itself the `startup` role and a company row; the sign-in
-- rule (web_login_identity, migration 96) accepts a company that is merely `pending`.
-- Company data stays closed (every company function checks recruiters.verified), so this is a
-- broken rule rather than a data leak - but "managed accounts only" is not true while they exist.
--
-- Nothing legitimate uses them any more:
--   * Admin -> Add College / Add company / Add admin  -> provision_*_account (97, 98),
--     security definer, called with the service key
--   * College -> import students                       -> create-student-users, service key
--   * the service key bypasses row-level security (01-compat-layer: service_role bypassrls)
--
-- Deliberately NOT touched:
--   * user_roles_admin_insert / _update / _delete  (administrators manage roles)
--   * recruiters_own_insert  (a managed company fills in its own company form once; the row
--     starts verified = false and shows nothing until an administrator verifies it)
--   * student_profiles_own_insert  (a student account cannot sign in without a college link)
--   * every SELECT and UPDATE policy
--
-- No row is changed or deleted. Existing accounts are unaffected.
begin;

drop policy if exists user_roles_self_claim on public.user_roles;
drop policy if exists startups_self_signup on public.startups;

-- colleges_own_insert also carried "or is_admin()"; keep that half under an honest name.
drop policy if exists colleges_own_insert on public.colleges;
drop policy if exists colleges_admin_insert on public.colleges;
create policy colleges_admin_insert on public.colleges
  for insert to authenticated
  with check (public.is_admin());

do $$
declare
  offender record;
begin
  -- Whatever the policies are called on this database, no INSERT-capable policy on these three
  -- tables may let a non-administrator in. An INSERT is governed by with_check (for a FOR ALL
  -- policy with no with_check, by its USING clause).
  for offender in
    select tablename, policyname, cmd, coalesce(with_check, qual, '') as rule
      from pg_policies
     where schemaname = 'public'
       and tablename in ('user_roles', 'colleges', 'startups')
       and cmd in ('INSERT', 'ALL')
       and coalesce(with_check, qual, '') !~ 'is_admin\s*\('
  loop
    raise exception
      '100 self-check: policy % on % (%) still lets a non-administrator insert: %',
      offender.policyname, offender.tablename, offender.cmd, offender.rule;
  end loop;

  -- "x or is_admin()" would pass the test above while still letting x in.
  for offender in
    select tablename, policyname, coalesce(with_check, qual, '') as rule
      from pg_policies
     where schemaname = 'public'
       and tablename in ('user_roles', 'colleges', 'startups')
       and cmd in ('INSERT', 'ALL')
       and coalesce(with_check, qual, '') ~ 'auth\.uid\s*\('
  loop
    raise exception
      '100 self-check: policy % on % still lets a login insert its own row: %',
      offender.policyname, offender.tablename, offender.rule;
  end loop;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'user_roles'
       and cmd = 'INSERT' and coalesce(with_check, '') ~ 'is_admin\s*\('
  ) then
    raise exception '100 self-check: administrators can no longer insert roles';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role' and rolbypassrls) then
    raise exception '100 self-check: service_role does not bypass row-level security; provisioning would break';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
