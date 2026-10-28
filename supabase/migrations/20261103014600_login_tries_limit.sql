-- 156 (MF-006, MF-007, MF-034): wrong-password tries are limited and logged by the login server.
-- Before, the login server sent every try straight to Google: ten quick wrong passwords all answered "wrong",
-- with no slow-down. The "login failed" records came from the browser (security-log function), so they could be
-- faked by anyone and were missing whenever the browser did not send them.
-- Now the login server (web-bff, service_role) asks web_login_gate before each try and writes every result
-- itself with log_security_event (source 'server'). The gate counts those server records:
--   * one email: 5 wrong tries within 15 minutes locks it until 15 minutes after the last wrong try;
--   * one IP address: 20 wrong tries within 15 minutes, same lock (looser: a college lab shares one address);
--   * bursts: at most 10 tries a minute per email and 60 a minute per address, wrong or not, so parallel
--     tries cannot slip past the count.
-- While locked the password is not checked at all, so even the right password is refused until the wait ends.
-- Rollback: migration/156-rollback-login-tries-limit.sql
begin;

create index if not exists security_events_login_failed_email_idx
  on public.security_events (email, created_at desc) where event_type = 'login_failed' and source = 'server';
create index if not exists security_events_login_failed_ip_idx
  on public.security_events (ip, created_at desc) where event_type = 'login_failed' and source = 'server';

create or replace function public.web_login_gate(_email text, _ip text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e text := lower(trim(coalesce(_email, '')));
  ip text := coalesce(nullif(trim(_ip), ''), 'unknown');
  burst_email jsonb;
  burst_ip jsonb;
  n int;
  last_at timestamptz;
begin
  burst_email := check_rate_limit('login-email', e, 10, 60);
  burst_ip := check_rate_limit('login-ip', ip, 60, 60);

  select count(*), max(created_at) into n, last_at from security_events
   where event_type = 'login_failed' and source = 'server' and email = e and created_at > now() - interval '15 minutes';
  if n >= 5 then
    return jsonb_build_object('allowed', false, 'reason', 'account_locked',
      'retry_after', greatest(1, ceil(extract(epoch from last_at + interval '15 minutes' - now())))::int);
  end if;

  select count(*), max(created_at) into n, last_at from security_events
   where event_type = 'login_failed' and source = 'server' and ip = _ip and created_at > now() - interval '15 minutes';
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

revoke all on function public.web_login_gate(text, text) from public, anon, authenticated;
grant execute on function public.web_login_gate(text, text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.web_login_gate(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.web_login_gate(text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.web_login_gate(text, text)', 'execute') then
    raise exception '156 self-check: web_login_gate must be server-only';
  end if;
  if not has_function_privilege('service_role', 'public.log_security_event(text, text, text, uuid, text, text, text, jsonb)', 'execute') then
    raise exception '156 self-check: the login server cannot write security events';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
