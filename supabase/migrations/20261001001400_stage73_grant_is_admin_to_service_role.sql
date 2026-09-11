-- stage73: let service-role edge functions insert into is_admin()-gated tables
--
-- task_sandbox_config/task_rubric_config's RLS policy is `using (is_admin())
-- with check (is_admin())`. Before stage71/72, the only writers were direct
-- SQL run as postgres (superuser, bypasses RLS entirely) — nothing ever
-- called INSERT through a service-role edge function client against a table
-- whose policy calls is_admin(). _shared/auto-config.ts (stage71) is the
-- first such caller, and it failed with "permission denied for function
-- is_admin" — not an RLS rejection, a plain missing EXECUTE grant.
--
-- is_admin() is STABLE, read-only, security definer, and already safe to
-- call from any trusted server context — granting service_role execute on
-- it does not change what it returns (auth.uid() is null under service_role,
-- so it evaluates false, same as it always would for a non-admin caller),
-- it only lets the policy evaluate instead of erroring.

grant execute on function public.is_admin() to service_role;
