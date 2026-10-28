-- ROLLBACK for 157: back to the 156 body, which fails on every call. Only useful together with rolling back 156.
begin;

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

commit;
