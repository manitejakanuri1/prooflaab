-- RLS already denies these: there is no INSERT, UPDATE or DELETE policy, so the
-- table grant alone achieves nothing. Removed anyway so that adding a permissive
-- policy later cannot silently open writes, and so the grants read the way the
-- table actually behaves.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.security_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rate_limit_counters FROM anon, authenticated;
REVOKE SELECT ON public.rate_limit_counters FROM anon, authenticated;;
