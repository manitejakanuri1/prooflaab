-- 421 (P7d, 12 Nov 2026): Admin > Companies showed "Last Active —" for every company. The screen never
-- fetched it: startups has no such column. Real source: the company login's web session (last_seen_at
-- is refreshed on every signed-in call; web_sessions is service-role only, so read it here for admins).
create or replace function public.admin_company_last_active()
returns table(startup_id uuid, last_active timestamptz)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select s.id, max(w.last_seen_at)
    from public.startups s
    join public.web_sessions w on w.user_id = s.user_id
   where public.is_admin()
   group by s.id;
$$;
revoke all on function public.admin_company_last_active() from public, anon;
grant execute on function public.admin_company_last_active() to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'admin_company_last_active' and prosecdef) then
    raise exception '421: function missing';
  end if;
  -- not an admin here (job runs as db owner without a JWT): must return nothing
  if exists (select 1 from public.admin_company_last_active()) then
    raise exception '421: non-admin got rows';
  end if;
end $$;

notify pgrst, 'reload schema';
