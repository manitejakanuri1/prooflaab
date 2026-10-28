-- ROLLBACK for 156. Roll the login server (web-bff) back first: it calls web_login_gate and refuses sign-in
-- (fails closed) when the gate is missing. Security events already written are kept.
begin;
drop function if exists public.web_login_gate(text, text);
drop index if exists public.security_events_login_failed_email_idx;
drop index if exists public.security_events_login_failed_ip_idx;
commit;

notify pgrst, 'reload schema';
