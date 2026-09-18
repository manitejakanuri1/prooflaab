-- An email can be held by an empty account: a database account row with no
-- role, no student, college or company record and no work - left behind by an
-- earlier sign-in or removal. The import saw "an account exists" and skipped
-- the student ("21 of 22 added", 18 Sep 2026, yashupilliking@gmail.com).
-- This clears such a shell so the import can create the student normally. It
-- refuses if the account has anything at all attached.
begin;

create or replace function public.drop_empty_account(_id uuid)
returns boolean
language plpgsql security definer set search_path = public, auth, pg_temp as $$
begin
  if exists (select 1 from public.user_roles       where user_id = _id)
  or exists (select 1 from public.student_profiles where id = _id or user_id = _id)
  or exists (select 1 from public.colleges         where user_id = _id)
  or exists (select 1 from public.startups         where user_id = _id)
  or exists (select 1 from public.recruiters       where id = _id) then
    return false;
  end if;
  delete from public.account_identities where user_id = _id;
  delete from public.student_intake    where user_id = _id;
  delete from auth.users               where id      = _id;
  return true;
end;
$$;

revoke all on function public.drop_empty_account(uuid) from public, anon, authenticated;
grant execute on function public.drop_empty_account(uuid) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.drop_empty_account(uuid)', 'EXECUTE') then
    raise exception 'a browser session could drop accounts';
  end if;
  -- The admin account must never count as empty.
  if public.drop_empty_account((select user_id from public.user_roles where role = 'admin' limit 1)) then
    raise exception 'drop_empty_account removed an admin';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
