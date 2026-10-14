-- 97: atomic database-side provisioning for admin-created company/admin accounts.
--
-- Identity Platform account creation happens before these calls. Once a UUID
-- exists, the role and organisation records must appear together or not at all.
begin;

create or replace function public.provision_company_account(
  _user_id uuid,
  _created_by uuid,
  _name text,
  _email text,
  _domain_industry text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
      from public.user_roles
     where user_id = _created_by
       and role = 'admin'::public.app_role
  ) then
    raise exception 'only an administrator can provision companies';
  end if;

  if nullif(trim(_name), '') is null
     or nullif(trim(_email), '') is null then
    raise exception 'company name and email are required';
  end if;

  if exists (
    select 1
      from public.user_roles
     where user_id = _user_id
  ) then
    raise exception 'account already has a platform role';
  end if;

  if exists (
    select 1
      from public.startups
     where lower(email) = lower(trim(_email))
  ) then
    raise exception 'company email already exists';
  end if;

  insert into public.user_roles (
    user_id,
    role,
    has_completed_wizard,
    created_by
  )
  values (
    _user_id,
    'startup'::public.app_role,
    true,
    _created_by
  );

  -- Admin-created companies are already approved by an administrator.
  -- company_sync_recruiter keeps the recruiter half in sync automatically.
  insert into public.startups (
    user_id,
    name,
    email,
    status,
    verification_status
  )
  values (
    _user_id,
    trim(_name),
    lower(trim(_email)),
    'active',
    'approved'
  );

  insert into public.startup_profiles (
    user_id,
    startup_name,
    domain_industry
  )
  values (
    _user_id,
    trim(_name),
    nullif(trim(coalesce(_domain_industry, '')), '')
  );
end;
$$;

revoke all
  on function public.provision_company_account(
    uuid, uuid, text, text, text
  )
  from public, anon, authenticated;

grant execute
  on function public.provision_company_account(
    uuid, uuid, text, text, text
  )
  to service_role;


create or replace function public.provision_admin_account(
  _user_id uuid,
  _created_by uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
      from public.user_roles
     where user_id = _created_by
       and role = 'admin'::public.app_role
  ) then
    raise exception 'only an administrator can provision administrators';
  end if;

  if exists (
    select 1
      from public.user_roles
     where user_id = _user_id
  ) then
    raise exception 'account already has a platform role';
  end if;

  insert into public.user_roles (
    user_id,
    role,
    has_completed_wizard,
    created_by
  )
  values (
    _user_id,
    'admin'::public.app_role,
    true,
    _created_by
  );
end;
$$;

revoke all
  on function public.provision_admin_account(uuid, uuid)
  from public, anon, authenticated;

grant execute
  on function public.provision_admin_account(uuid, uuid)
  to service_role;


do $$
begin
  if to_regprocedure(
    'public.provision_company_account(uuid,uuid,text,text,text)'
  ) is null then
    raise exception '97 self-check: provision_company_account missing';
  end if;

  if to_regprocedure(
    'public.provision_admin_account(uuid,uuid)'
  ) is null then
    raise exception '97 self-check: provision_admin_account missing';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.provision_company_account(uuid,uuid,text,text,text)',
    'execute'
  ) then
    raise exception '97 self-check: browser can provision companies';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.provision_admin_account(uuid,uuid)',
    'execute'
  ) then
    raise exception '97 self-check: browser can provision admins';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.provision_company_account(uuid,uuid,text,text,text)',
    'execute'
  ) then
    raise exception '97 self-check: service_role company grant missing';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.provision_admin_account(uuid,uuid)',
    'execute'
  ) then
    raise exception '97 self-check: service_role admin grant missing';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
