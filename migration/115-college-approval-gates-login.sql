-- 115: a college that is not approved cannot sign in, and every refusal says exactly why (owner, 14 Oct, option B).
-- NOT APPLIED ANYWHERE. Staging first; owner's yes needed. Requires 110 (web_login_identity_base).
--
-- Before: web_login_identity (102 via 110) let a college admin sign in while the college was still PENDING
-- approval; every college screen then said "not a college account" (my_college_id needs approval). And a
-- refused student only ever got the generic reason "student_not_college_managed".
--
-- Now the public web_login_identity checks, in front of 102's unchanged base:
--   college admin: rejected -> college_rejected; suspended -> college_suspended; not approved -> college_pending_approval
--   student:       their college is not active and approved -> college_not_active
-- Everything else (no role, missing college, student status, onboarding, companies, admins) is still decided
-- by 102's base function, unchanged. The BFF and the auth-bridge both call this function, so sign-in, the
-- 30 s session re-check and token minting all follow it; 101's triggers revoke live sessions through it too.
-- Nothing here changes a row.
-- Rollback: 115-rollback-college-approval-gates-login.sql (110's wrapper, verbatim).
begin;

create or replace function public.web_login_identity(_user_id uuid)
returns jsonb language plpgsql security definer volatile set search_path = public, pg_temp as $$
declare
  account_role text;
  c_status text;
  c_approval text;
begin
  if public.identity_access_blocked(_user_id) then
    return jsonb_build_object('allowed', false, 'reason', 'identity_missing');
  end if;

  select role::text into account_role from public.user_roles where user_id = _user_id;

  if account_role = 'college_admin' then
    select c.status, c.verification_status into c_status, c_approval
      from public.colleges c where c.user_id = _user_id limit 1;
    if found then
      if c_approval = 'rejected' then
        return jsonb_build_object('allowed', false, 'reason', 'college_rejected');
      elsif c_status = 'suspended' then
        return jsonb_build_object('allowed', false, 'reason', 'college_suspended');
      elsif c_approval is distinct from 'approved' then
        return jsonb_build_object('allowed', false, 'reason', 'college_pending_approval');
      end if;
    end if;
  elsif account_role = 'student' then
    select c.status, c.verification_status into c_status, c_approval
      from public.student_profiles sp join public.colleges c on c.id = sp.college_id
     where sp.user_id = _user_id limit 1;
    if found and (c_status is distinct from 'active' or c_approval is distinct from 'approved') then
      return jsonb_build_object('allowed', false, 'reason', 'college_not_active');
    end if;
  end if;

  return public.web_login_identity_base(_user_id);
end $$;
revoke all on function public.web_login_identity(uuid) from public, anon, authenticated;
grant execute on function public.web_login_identity(uuid) to service_role;

do $$
declare d text := pg_get_functiondef('public.web_login_identity(uuid)'::regprocedure);
begin
  if position('college_pending_approval' in d) = 0 or position('college_not_active' in d) = 0
     or position('identity_access_blocked' in d) = 0 or position('web_login_identity_base' in d) = 0 then
    raise exception '115 self-check: web_login_identity is not the 115 body';
  end if;
  if has_function_privilege('authenticated', 'public.web_login_identity(uuid)', 'execute')
     or has_function_privilege('anon', 'public.web_login_identity(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.web_login_identity(uuid)', 'execute') then
    raise exception '115 self-check: web_login_identity privileges wrong';
  end if;
end $$;

commit;
