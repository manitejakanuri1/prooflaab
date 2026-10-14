-- 96: managed-account login identity + exactly one unrevoked BFF session.
--
-- Browser roles cannot call these helpers. The web BFF calls them using its
-- short-lived service_role token.
begin;

-- Clean up any historical duplicate unrevoked rows before enforcing the
-- invariant. The newest row wins. This touches sessions only, never user data.
with ranked as (
  select
    session_hash,
    row_number() over (
      partition by user_id
      order by created_at desc, session_hash desc
    ) as rn
  from public.web_sessions
  where revoked_at is null
)
update public.web_sessions ws
   set revoked_at = now(),
       last_seen_at = now()
  from ranked r
 where ws.session_hash = r.session_hash
   and r.rn > 1;

create unique index web_sessions_one_unrevoked_per_user
  on public.web_sessions (user_id)
  where revoked_at is null;

create or replace function public.web_replace_session(
  _session_hash text,
  _user_id uuid,
  _encrypted_payload text,
  _created_at timestamptz,
  _expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if _session_hash is null
     or _session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid session hash';
  end if;

  if _encrypted_payload is null
     or length(_encrypted_payload) < 32 then
    raise exception 'invalid encrypted payload';
  end if;

  if _expires_at <= _created_at then
    raise exception 'invalid session expiry';
  end if;

  -- Serialize logins for the same user. Without this, two simultaneous
  -- browsers could race while replacing one another.
  perform pg_advisory_xact_lock(
    hashtextextended(_user_id::text, 0)
  );

  update public.web_sessions
     set revoked_at = _created_at,
         last_seen_at = _created_at
   where user_id = _user_id
     and revoked_at is null;

  insert into public.web_sessions (
    session_hash,
    user_id,
    encrypted_payload,
    created_at,
    last_seen_at,
    expires_at,
    revoked_at
  )
  values (
    _session_hash,
    _user_id,
    _encrypted_payload,
    _created_at,
    _created_at,
    _expires_at,
    null
  );
end;
$$;

revoke all
  on function public.web_replace_session(
    text, uuid, text, timestamptz, timestamptz
  )
  from public, anon, authenticated;

grant execute
  on function public.web_replace_session(
    text, uuid, text, timestamptz, timestamptz
  )
  to service_role;


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
       or account_status = 'suspended'
       or onboarding = 'blocked' then
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

revoke all
  on function public.web_login_identity(uuid)
  from public, anon, authenticated;

grant execute
  on function public.web_login_identity(uuid)
  to service_role;


do $$
begin
  if to_regprocedure(
    'public.web_replace_session(text,uuid,text,timestamp with time zone,timestamp with time zone)'
  ) is null then
    raise exception '96 self-check: web_replace_session missing';
  end if;

  if to_regprocedure(
    'public.web_login_identity(uuid)'
  ) is null then
    raise exception '96 self-check: web_login_identity missing';
  end if;

  if has_function_privilege(
    'anon',
    'public.web_login_identity(uuid)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.web_login_identity(uuid)',
    'execute'
  ) then
    raise exception '96 self-check: browser can execute web_login_identity';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.web_login_identity(uuid)',
    'execute'
  ) then
    raise exception '96 self-check: service_role cannot read login identity';
  end if;

  if has_function_privilege(
    'anon',
    'public.web_replace_session(text,uuid,text,timestamp with time zone,timestamp with time zone)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.web_replace_session(text,uuid,text,timestamp with time zone,timestamp with time zone)',
    'execute'
  ) then
    raise exception '96 self-check: browser can replace sessions';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.web_replace_session(text,uuid,text,timestamp with time zone,timestamp with time zone)',
    'execute'
  ) then
    raise exception '96 self-check: service_role cannot replace sessions';
  end if;

  if not exists (
    select 1
      from pg_indexes
     where schemaname = 'public'
       and tablename = 'web_sessions'
       and indexname = 'web_sessions_one_unrevoked_per_user'
  ) then
    raise exception '96 self-check: single-session index missing';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
