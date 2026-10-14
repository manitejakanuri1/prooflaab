-- Rollback for 115: web_login_identity back to 110's wrapper, verbatim (pending colleges may sign in again and
-- refusals use 102's reasons). NOT APPLIED ANYWHERE. No row is changed.
begin;

create or replace function public.web_login_identity(_user_id uuid)
returns jsonb language plpgsql security definer volatile set search_path = public, pg_temp as $$
begin
  if public.identity_access_blocked(_user_id) then
    return jsonb_build_object('allowed', false, 'reason', 'identity_missing');
  end if;
  return public.web_login_identity_base(_user_id);
end $$;
revoke all on function public.web_login_identity(uuid) from public, anon, authenticated;
grant execute on function public.web_login_identity(uuid) to service_role;

commit;
