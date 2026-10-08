-- 102: student access enforcement; requires 96 and 101.
begin;

create or replace function public.web_login_identity(
  _user_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  account_role public.app_role;
  wizard boolean;

  person_name text;
  college uuid;
  account_status text;
  onboarding text;
  verification text;
begin
  select ur.role, ur.has_completed_wizard
    into account_role, wizard
    from public.user_roles ur
   where ur.user_id = _user_id;

  if account_role is null then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'account_not_provisioned'
    );
  end if;

  if account_role = 'student' then
    select
      sp.full_name,
      sp.college_id,
      sp.status,
      sp.onboarding_status
      into
        person_name,
        college,
        account_status,
        onboarding
      from public.student_profiles sp
     where sp.user_id = _user_id;

    if person_name is null
       or college is null
       or account_status in ('suspended', 'blocked', 'deleted')
       or onboarding = 'blocked'
       or not exists (
         select 1 from public.colleges c
          where c.id = college
            and c.status <> 'suspended'
       ) then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'student_not_college_managed'
      );
    end if;

    return jsonb_build_object(
      'allowed', true,
      'role', 'student',
      'full_name', person_name,
      'account_type', 'student',
      'has_completed_wizard', coalesce(wizard, false),
      'college_id', college,
      'onboarding_status', onboarding
    );
  end if;

  if account_role = 'college_admin' then
    select
      c.name,
      c.status,
      c.verification_status
      into
        person_name,
        account_status,
        verification
      from public.colleges c
     where c.user_id = _user_id;

    if person_name is null
       or account_status = 'suspended'
       or verification = 'rejected' then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'college_account_unavailable'
      );
    end if;

    return jsonb_build_object(
      'allowed', true,
      'role', 'college_admin',
      'full_name', person_name,
      'account_type', 'college_admin',
      'has_completed_wizard', coalesce(wizard, false)
    );
  end if;

  if account_role = 'startup' then
    select
      s.name,
      s.status,
      s.verification_status
      into
        person_name,
        account_status,
        verification
      from public.startups s
     where s.user_id = _user_id;

    if person_name is null
       or account_status = 'suspended'
       or verification = 'rejected' then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'company_account_unavailable'
      );
    end if;

    return jsonb_build_object(
      'allowed', true,
      'role', 'startup',
      'full_name', person_name,
      'account_type', 'startup',
      'has_completed_wizard', coalesce(wizard, false)
    );
  end if;

  if account_role = 'admin' then
    select nullif(
      u.raw_user_meta_data ->> 'full_name',
      ''
    )
      into person_name
      from auth.users u
     where u.id = _user_id;

    return jsonb_build_object(
      'allowed', true,
      'role', 'admin',
      'full_name', person_name,
      'account_type', 'admin',
      'has_completed_wizard', true
    );
  end if;

  return jsonb_build_object(
    'allowed', false,
    'reason', 'unsupported_role'
  );
end;
$$;


revoke all on function public.web_login_identity(uuid) from public,anon,authenticated;
grant execute on function public.web_login_identity(uuid) to service_role;
create or replace function public.revoke_college_student_sessions() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin if new.status='suspended' and old.status is distinct from new.status then update public.web_sessions ws set revoked_at=now(),last_seen_at=now() where ws.revoked_at is null and exists(select 1 from public.student_profiles sp where sp.college_id=new.id and sp.user_id=ws.user_id); end if; return new; end; $$;
revoke all on function public.revoke_college_student_sessions() from public,anon,authenticated;
drop trigger if exists revoke_college_student_sessions on public.colleges;
create trigger revoke_college_student_sessions after update of status on public.colleges for each row execute function public.revoke_college_student_sessions();
update public.web_sessions ws set revoked_at=now(),last_seen_at=now() where ws.revoked_at is null and exists(select 1 from public.user_roles ur where ur.user_id=ws.user_id and ur.role='student'::public.app_role) and not coalesce((public.web_login_identity(ws.user_id)->>'allowed')::boolean,false);
do $$ begin if not exists(select 1 from pg_trigger where tgname='revoke_sessions_when_access_ends' and tgrelid='public.student_profiles'::regclass and not tgisinternal) then raise exception '101 missing'; end if; if not exists(select 1 from pg_trigger where tgname='revoke_college_student_sessions' and tgrelid='public.colleges'::regclass and not tgisinternal) then raise exception 'college trigger missing'; end if; if has_function_privilege('authenticated','public.web_login_identity(uuid)','execute') or has_function_privilege('anon','public.web_login_identity(uuid)','execute') then raise exception 'login privilege exposed'; end if; end $$;
commit;
notify pgrst,'reload schema';
