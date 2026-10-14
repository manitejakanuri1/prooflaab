-- Rollback for 101: removes the four session triggers and their functions. NOT APPLIED ANYWHERE.
--
-- Sessions already revoked stay revoked (those people sign in again). After this, a suspended
-- account is ended only by the web BFF's own re-check (at most 30 s later), provided the BFF
-- that contains it is the one running.
begin;

drop trigger if exists revoke_sessions_when_access_ends on public.colleges;
drop trigger if exists revoke_sessions_when_access_ends on public.startups;
drop trigger if exists revoke_sessions_when_access_ends on public.student_profiles;
drop trigger if exists revoke_sessions_when_role_changes on public.user_roles;

drop function if exists public.revoke_sessions_on_account_change();
drop function if exists public.revoke_sessions_on_role_change();
drop function if exists public.revoke_sessions_if_not_allowed(uuid);

commit;

notify pgrst, 'reload schema';
