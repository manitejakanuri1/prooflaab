-- Let a function find an account by email.
--
-- create-student-users calls auth.admin.listUsers() and searches the result for
-- an email, so that a student who signed up on their own before their college
-- uploaded a CSV is linked rather than duplicated. On Google that answer lives
-- in Identity Platform, and reading it there needs an administrator credential
-- this service deliberately does not hold.
--
-- The same answer is already in the database. PostgREST only exposes the public
-- schema, so this is a small function in public that reads auth.users, and it is
-- executable by service_role alone - the role only server-side function code
-- ever holds. A student or a college calling it gets "permission denied".
--
-- It returns the id and nothing else. Not the password hash, not the metadata,
-- not the other accounts: the caller asked "does this email have an account",
-- and that is the whole answer.

begin;

create or replace function public.account_id_for_email(_email text)
returns uuid
language sql
security definer
set search_path = public, auth
stable
as $$
  select id from auth.users
   where lower(email) = lower(trim(_email))
   limit 1;
$$;

comment on function public.account_id_for_email(text) is
  'Server-side only. Returns the account id for an email, or null. '
  'Replaces auth.admin.listUsers() for the Google backend.';

-- Revoke first: a new function is executable by PUBLIC by default, which would
-- let any signed-in student test whether an email has an account.
revoke all on function public.account_id_for_email(text) from public;
revoke all on function public.account_id_for_email(text) from anon, authenticated;
grant execute on function public.account_id_for_email(text) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.account_id_for_email(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.account_id_for_email(text)', 'EXECUTE') then
    raise exception 'account_id_for_email is reachable by a browser role; that is an email-enumeration hole';
  end if;
  if not has_function_privilege('service_role', 'public.account_id_for_email(text)', 'EXECUTE') then
    raise exception 'service_role cannot execute account_id_for_email, so imports would fail';
  end if;
  raise notice 'account_id_for_email created, service_role only';
end $$;

commit;
