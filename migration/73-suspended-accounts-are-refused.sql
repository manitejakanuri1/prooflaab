-- 73: a suspended student's still-valid login ticket stops working at once (G1).
-- Suspension (migration 55) set student_profiles.status = 'suspended', but nothing read it:
-- a ticket issued before the suspension kept working for its full hour - today's Lot, Run,
-- Submit, recordings, profile edits.
--   account_is_suspended(uuid)  - one indexed lookup; used by the API hook below and by the
--                                 functions service (which reaches the database as the server).
--   refuse_suspended()          - PostgREST runs it before EVERY request (setting
--                                 PGRST_DB_PRE_REQUEST=public.refuse_suspended). A signed-in
--                                 caller whose account is suspended gets 403 and nothing else.
-- Restoring the student restores access immediately. Protected test accounts cannot be
-- suspended by the sync job in the first place (migration 55).
begin;

create or replace function public.account_is_suspended(_user uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select exists (select 1 from public.student_profiles p where p.id = _user and p.status = 'suspended');
$function$;
revoke all on function public.account_is_suspended(uuid) from public, anon, authenticated;
grant execute on function public.account_is_suspended(uuid) to service_role;

create or replace function public.refuse_suspended()
returns void language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare claims jsonb; uid uuid;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return;                                   -- no readable ticket: the normal rules decide
  end;
  if claims is null or claims ->> 'role' is distinct from 'authenticated' then
    return;                                   -- anonymous and server calls are not people
  end if;
  begin
    uid := (claims ->> 'sub')::uuid;
  exception when others then
    return;
  end;
  if public.account_is_suspended(uid) then
    raise sqlstate 'PT403' using
      message = 'This account is suspended. Please contact your college.',
      hint = 'account_suspended';
  end if;
end $function$;
revoke all on function public.refuse_suspended() from public;
grant execute on function public.refuse_suspended() to anon, authenticated, service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.account_is_suspended(uuid)', 'execute') then
    raise exception '73 self-check: a browser can ask who is suspended';
  end if;
  if not has_function_privilege('authenticated', 'public.refuse_suspended()', 'execute')
     or not has_function_privilege('anon', 'public.refuse_suspended()', 'execute') then
    raise exception '73 self-check: the API roles cannot run the pre-request check (every request would fail)';
  end if;
  perform public.refuse_suspended();          -- no ticket here: must simply return
end $$;

commit;

notify pgrst, 'reload schema';
