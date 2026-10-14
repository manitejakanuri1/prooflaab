-- 98: admin-created college account provisioning is one DB transaction.
--
-- Identity creation happens first through the trusted Accounts service.
-- This RPC makes role + college appear together or not at all.
begin;

create or replace function public.provision_college_account(
  _user_id uuid,
  _created_by uuid,
  _name text,
  _email text,
  _status text default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  college_id uuid;
  wanted_status text :=
    coalesce(nullif(trim(_status), ''), 'active');
begin
  if not exists (
    select 1
      from public.user_roles
     where user_id = _created_by
       and role = 'admin'::public.app_role
  ) then
    raise exception
      'only an administrator can provision colleges';
  end if;

  if nullif(trim(_name), '') is null
     or nullif(trim(_email), '') is null then
    raise exception
      'college name and email are required';
  end if;

  if wanted_status not in (
    'pending',
    'active',
    'suspended'
  ) then
    raise exception
      'invalid college status';
  end if;

  if exists (
    select 1
      from public.user_roles
     where user_id = _user_id
  ) then
    raise exception
      'account already has a platform role';
  end if;

  if exists (
    select 1
      from public.colleges
     where lower(email) = lower(trim(_email))
  ) then
    raise exception
      'college email already exists';
  end if;

  insert into public.user_roles (
    user_id,
    role,
    has_completed_wizard,
    created_by
  )
  values (
    _user_id,
    'college_admin'::public.app_role,
    true,
    _created_by
  );

  insert into public.colleges (
    user_id,
    name,
    email,
    status
  )
  values (
    _user_id,
    trim(_name),
    lower(trim(_email)),
    wanted_status
  )
  returning id into college_id;

  return college_id;
end;
$$;

revoke all
  on function public.provision_college_account(
    uuid, uuid, text, text, text
  )
  from public, anon, authenticated;

grant execute
  on function public.provision_college_account(
    uuid, uuid, text, text, text
  )
  to service_role;

do $$
begin
  if to_regprocedure(
    'public.provision_college_account(uuid,uuid,text,text,text)'
  ) is null then
    raise exception
      '98 self-check: provision_college_account missing';
  end if;

  if has_function_privilege(
    'anon',
    'public.provision_college_account(uuid,uuid,text,text,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.provision_college_account(uuid,uuid,text,text,text)',
    'execute'
  ) then
    raise exception
      '98 self-check: browser can provision colleges';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.provision_college_account(uuid,uuid,text,text,text)',
    'execute'
  ) then
    raise exception
      '98 self-check: service_role grant missing';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
