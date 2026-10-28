-- 157: fix to 156. web_login_gate had a variable named ip, the same as the security_events column, so every
-- call failed ("column reference ip is ambiguous") and the login server refused all sign-ins (it fails closed).
-- Found on TEST minutes after 156; same rules, the variable is renamed and the columns are qualified.
-- This time the self-check runs the gate once and removes the counter rows it made.
-- Rollback: migration/157-rollback-login-gate-name-fix.sql (puts back the broken 156 body; roll web-bff back first)
begin;

create or replace function public.web_login_gate(_email text, _ip text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e text := lower(trim(coalesce(_email, '')));
  addr text := coalesce(nullif(trim(_ip), ''), 'unknown');
  burst_email jsonb;
  burst_ip jsonb;
  n int;
  last_at timestamptz;
begin
  burst_email := check_rate_limit('login-email', e, 10, 60);
  burst_ip := check_rate_limit('login-ip', addr, 60, 60);

  select count(*), max(s.created_at) into n, last_at from security_events s
   where s.event_type = 'login_failed' and s.source = 'server' and s.email = e and s.created_at > now() - interval '15 minutes';
  if n >= 5 then
    return jsonb_build_object('allowed', false, 'reason', 'account_locked',
      'retry_after', greatest(1, ceil(extract(epoch from last_at + interval '15 minutes' - now())))::int);
  end if;

  select count(*), max(s.created_at) into n, last_at from security_events s
   where s.event_type = 'login_failed' and s.source = 'server' and s.ip = _ip and s.created_at > now() - interval '15 minutes';
  if n >= 20 then
    return jsonb_build_object('allowed', false, 'reason', 'address_locked',
      'retry_after', greatest(1, ceil(extract(epoch from last_at + interval '15 minutes' - now())))::int);
  end if;

  if not (burst_email ->> 'allowed')::boolean or not (burst_ip ->> 'allowed')::boolean then
    return jsonb_build_object('allowed', false, 'reason', 'too_many_tries',
      'retry_after', greatest((burst_email ->> 'retry_after')::int, (burst_ip ->> 'retry_after')::int));
  end if;

  return jsonb_build_object('allowed', true);
end $$;

do $$
declare
  answer jsonb;
begin
  answer := public.web_login_gate('migration-157-selfcheck@invalid.test', '192.0.2.157');
  if (answer ->> 'allowed') is distinct from 'true' then
    raise exception '157 self-check: a fresh email was refused: %', answer;
  end if;
  delete from public.rate_limits where subject in ('migration-157-selfcheck@invalid.test', '192.0.2.157');
end $$;

commit;
